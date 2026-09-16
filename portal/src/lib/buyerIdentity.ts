/**
 * What the checkout already knows about the person buying, so it stops
 * asking them twice.
 *
 * The accommodation step used to open with a "booking contact" block asking
 * for an email and a phone, and the buyer step three screens later asked for
 * the email and the name again. Both are the same human in every case this
 * checkout supports: there is one payer, one cart and one room. So the
 * contact is not collected, it is *derived*, and the accommodation step is
 * left asking only what nobody else can answer.
 *
 * Two sources, because the two funnels know the buyer differently. A direct
 * sale learns them from the buyer step, which is why `covers` is read off
 * the *schema* rather than off the values: the buyer step comes after the
 * accommodation step (`DEFAULT_TICKETING_STEPS` orders housing 1, buyer 4),
 * so at the moment the room is picked the values are still empty and only
 * the schema can say what is coming. An application flow has no buyer step
 * at all and learns them from the account, where the values already exist.
 *
 * Coverage is decided by the field's `key`, never by its type or its label.
 * A key is what the answer is stored under and it is frozen at creation
 * (`makeKey` in the backoffice's `guestForm.ts`), so `email` means the same
 * thing in every form on every tenant. Matching on the type instead would
 * quietly swallow the second email a form asks for, which is exactly the one
 * that is not the buyer's: an emergency contact.
 */

import type { SelectedAccommodationItem } from "@/types/checkout"
import type { ApplicationFormSchema } from "@/types/form-schema"

/**
 * Guest-form keys the checkout can answer on the buyer's behalf, mapped to
 * the part of the buyer it takes the answer from.
 *
 * Deliberately short. Anything outside this set is a question about the stay
 * rather than about the buyer, and the step keeps asking it. `name` and
 * `full_name` are both here because `slugify` turns the two labels an
 * operator actually types ("Name", "Full name") into those two keys.
 */
const COVERABLE = {
  email: "email",
  phone: "phone",
  first_name: "firstName",
  last_name: "lastName",
  name: "name",
  full_name: "name",
} as const

type CoverableKey = keyof typeof COVERABLE
type IdentityPart = (typeof COVERABLE)[CoverableKey]

export interface BuyerIdentity {
  /**
   * Guest-form field keys this checkout answers itself. The step neither
   * renders these nor gates on them, and they are filled in on the way to
   * the server.
   */
  covers: ReadonlySet<string>
  /**
   * Whether the lead occupant's *name* comes from here. Separate from
   * `covers` because that name is a column on the booking rather than a
   * field in the form, and `require_guest_names` governs it.
   */
  namesLeadGuest: boolean
  /** The answers themselves, keyed the way a guest form keys them. Empty
   *  while the buyer step is still ahead of the buyer. */
  answers: Readonly<Record<string, string>>
  /** For the one line that says whose booking this is. */
  name: string
  email: string
}

/** A checkout that knows nothing about its buyer yet, and so hides nothing. */
export const NO_BUYER_IDENTITY: BuyerIdentity = {
  covers: new Set<string>(),
  namesLeadGuest: false,
  answers: {},
  name: "",
  email: "",
}

export interface BuyerIdentitySource {
  /** Direct sale: the buyer step's schema, which says what will be asked. */
  buyerFormSchema?: ApplicationFormSchema | null
  /** Direct sale: what has been typed into it so far. */
  buyerValues?: Record<string, unknown>
  /** Application flow: the logged-in account, which already knows. */
  human?: {
    email?: string | null
    first_name?: string | null
    last_name?: string | null
  } | null
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function fullName(first: string, last: string): string {
  return [first, last].filter(Boolean).join(" ")
}

/**
 * The buyer-form field a phone number would be typed into, if it asks for one.
 *
 * By name first, because `phone` is what the form builder slugs "Phone" to
 * and what the vast majority of popups therefore carry. By type second,
 * because a popup that called the field "WhatsApp" is still asking for the
 * one number the property would ring, and there is no ambiguity to protect
 * against: unlike email, a form asking for two different phone numbers on
 * the buyer is not a thing anyone builds.
 */
function phoneFieldName(schema: ApplicationFormSchema): string | null {
  const base = schema.base_fields ?? {}
  if (base.phone) return "phone"
  const typed = Object.entries(base).find(
    ([, field]) => field?.type === "phone",
  )
  return typed ? typed[0] : null
}

function fromBuyerForm(
  schema: ApplicationFormSchema,
  values: Record<string, unknown>,
): BuyerIdentity {
  const base = schema.base_fields ?? {}
  const covers = new Set<string>()
  const parts: Partial<Record<IdentityPart, string>> = {}

  // Email and the two name halves are forced into every open checkout's
  // schema by `buildOpenBuyerSchema`, so they are always coming. Reading
  // them off `base` anyway keeps this honest if that ever stops being true.
  if (base.email) {
    covers.add("email")
    parts.email = text(values.email)
  }
  const first = base.first_name ? text(values.first_name) : ""
  const last = base.last_name ? text(values.last_name) : ""
  if (base.first_name) {
    covers.add("first_name")
    parts.firstName = first
  }
  if (base.last_name) {
    covers.add("last_name")
    parts.lastName = last
  }
  if (base.first_name || base.last_name) {
    covers.add("name")
    covers.add("full_name")
    parts.name = fullName(first, last)
  }

  const phoneField = phoneFieldName(schema)
  if (phoneField) {
    covers.add("phone")
    parts.phone = text(values[phoneField])
  }

  return {
    covers,
    // The buyer step's own schema makes both halves required, and the funnel
    // will not let anyone pay past it, so a name is guaranteed by the time
    // it matters even though there is none on this screen yet.
    namesLeadGuest: !!base.first_name || !!base.last_name,
    answers: answersFrom(covers, parts),
    name: parts.name ?? "",
    email: parts.email ?? "",
  }
}

function fromAccount(human: NonNullable<BuyerIdentitySource["human"]>) {
  const email = text(human.email)
  const first = text(human.first_name)
  const last = text(human.last_name)
  const name = fullName(first, last)
  const covers = new Set<string>()
  const parts: Partial<Record<IdentityPart, string>> = {}

  // An account's values are already in hand, so unlike the buyer form there
  // is nothing to promise: what is blank on the account stays the step's
  // question to ask.
  if (email) {
    covers.add("email")
    parts.email = email
  }
  if (first) {
    covers.add("first_name")
    parts.firstName = first
  }
  if (last) {
    covers.add("last_name")
    parts.lastName = last
  }
  if (name) {
    covers.add("name")
    covers.add("full_name")
    parts.name = name
  }

  return {
    covers,
    namesLeadGuest: !!name,
    answers: answersFrom(covers, parts),
    name,
    email,
  }
}

/** The covered keys that currently have something to say. */
function answersFrom(
  covers: ReadonlySet<string>,
  parts: Partial<Record<IdentityPart, string>>,
): Record<string, string> {
  const answers: Record<string, string> = {}
  for (const key of covers) {
    const value = parts[COVERABLE[key as CoverableKey]]
    if (value) answers[key] = value
  }
  return answers
}

/**
 * Who the checkout thinks is buying.
 *
 * The buyer form wins when there is one: a direct sale asks the buyer
 * themselves, and an account may be signed in on the same browser without
 * being the person filling in this checkout.
 */
export function buildBuyerIdentity(source: BuyerIdentitySource): BuyerIdentity {
  if (source.buyerFormSchema) {
    return fromBuyerForm(source.buyerFormSchema, source.buyerValues ?? {})
  }
  if (source.human) return fromAccount(source.human)
  return NO_BUYER_IDENTITY
}

/**
 * One booking with the buyer's own answers filled in.
 *
 * Blanks only, so anything typed on the screen wins: a buyer who opened the
 * contact line and put someone else's name there is booking for that person,
 * and this must not put their own back. Applied on the way to the server
 * rather than into the cart, so there is exactly one place where a derived
 * answer becomes a real one and no effect racing the pay button.
 */
export function withBuyerIdentity(
  item: SelectedAccommodationItem,
  identity: BuyerIdentity,
): SelectedAccommodationItem {
  if (Object.keys(identity.answers).length === 0 && !identity.name) return item

  const fill = (answers: Record<string, unknown>) => {
    let next = answers
    for (const [key, value] of Object.entries(identity.answers)) {
      const current = next[key]
      if (typeof current === "string" ? current.trim() : current != null) {
        continue
      }
      if (next === answers) next = { ...answers }
      next[key] = value
    }
    return next
  }

  const guests = item.guests.map((guest, index) =>
    index === 0
      ? {
          ...guest,
          name: guest.name?.trim() ? guest.name : identity.name,
          answers: fill(guest.answers ?? {}),
        }
      : guest,
  )

  return {
    ...item,
    bookerAnswers: fill(item.bookerAnswers ?? {}),
    guests,
  }
}
