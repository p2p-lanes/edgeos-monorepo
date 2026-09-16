/**
 * Whether the guest details a buyer typed will be accepted.
 *
 * Mirrors `validate_answers` in `backend/app/api/accommodation/guest_form.py`
 * **in the same order**: the booker first, then each guest in turn, and
 * within a field the same checks in the same sequence. The order is the part
 * that matters. If this reported a guest's missing answer while the booker's
 * was also missing, a buyer would fix what they were told about and then be
 * refused again for something else, one field at a time.
 *
 * The server stays the authority. This exists so the refusal arrives while
 * the buyer is still typing rather than after they press pay.
 */

import type { BuyerIdentity } from "@/lib/buyerIdentity"
import { NO_BUYER_IDENTITY } from "@/lib/buyerIdentity"
import type { SelectedAccommodationItem } from "@/types/checkout"

/**
 * One question, as `template_config.guest_form` stores it.
 *
 * Declared here rather than imported from `@/client`: the form lives inside
 * a step's `template_config`, which is an untyped JSON column, so the
 * generated client has no shape for it. `parseGuestForm` is the only door
 * in, and it is the reason every field below is optional.
 */
export interface GuestFormField {
  key: string
  type: string
  label: string
  required?: boolean
  placeholder?: string | null
  help_text?: string | null
  options?: string[]
  width?: "full" | "half" | "half_row" | null
  config?: Record<string, unknown>
}

export interface GuestFormSection {
  title?: string | null
  description?: string | null
  fields?: GuestFormField[]
}

export interface AccommodationGuestForm {
  version?: number
  booker?: GuestFormSection
  guests?: GuestFormSection & {
    mode?: "same_as_booker" | "custom" | "off"
  }
}

export type GuestAnswers = Record<string, unknown>

export interface GuestFormProblem {
  /** The field's key, so the input can be pointed at. */
  field: string
  /** Zero-based occupant, or null for the booker. */
  guestIndex: number | null
  message: string
}

/**
 * The step's stored form, or null when there is nothing to ask.
 *
 * Mirrors `parse_form` on the backend, including its forgiveness: this reads
 * a column somebody already saved, and a form that no longer makes sense
 * must not take the checkout down with it. A form whose two sections are
 * both empty is no form, so callers have one thing to check.
 */
export function parseGuestForm(raw: unknown): AccommodationGuestForm | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const form = raw as AccommodationGuestForm
  const asksNothing =
    bookerFieldsOf(form).length === 0 && guestFieldsOf(form).length === 0
  return asksNothing ? null : form
}

/** The fields each additional guest is asked, `mode` resolved. */
export function guestFieldsOf(
  form: AccommodationGuestForm | null | undefined,
): GuestFormField[] {
  if (!form) return []
  const mode = form.guests?.mode ?? "same_as_booker"
  if (mode === "off") return []
  if (mode === "custom") return form.guests?.fields ?? []
  return form.booker?.fields ?? []
}

export function bookerFieldsOf(
  form: AccommodationGuestForm | null | undefined,
): GuestFormField[] {
  return form?.booker?.fields ?? []
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === "string") return value.trim() === ""
  if (Array.isArray(value)) return value.length === 0
  return false
}

function looksLikeEmail(value: unknown): boolean {
  const text = String(value).trim()
  if (text.includes(" ") || (text.match(/@/g) ?? []).length !== 1) return false
  const [local, domain] = text.split("@")
  return !!local && domain.includes(".") && !domain.startsWith(".")
}

function asNumber(value: unknown): number | null {
  const parsed = Number(String(value).trim())
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The first thing wrong with one field's answer, or null.
 *
 * Kept exported so a single input can be checked on blur without walking the
 * whole form: the panel shows an error next to the field the buyer just left,
 * not at the bottom of the page.
 */
export function checkField(
  field: GuestFormField,
  answers: GuestAnswers,
): string | null {
  const value = answers[field.key]
  const label = field.label

  if (isBlank(value)) {
    return field.required ? `${label} is required` : null
  }

  if (field.type === "boolean") {
    // A required consent is answered by being ticked. `false` is an answer,
    // and it is not the one that satisfies it.
    return field.required && value !== true ? `${label} is required` : null
  }

  const options = field.options ?? []

  if ((field.type === "select" || field.type === "radio") && options.length) {
    if (!options.includes(String(value))) {
      return `${label}: pick one of the offered options`
    }
  }

  if (field.type === "multiselect" && options.length) {
    const values = Array.isArray(value) ? value : [value]
    if (values.some((item) => !options.includes(String(item)))) {
      return `${label}: pick from the offered options`
    }
  }

  if (field.type === "email" && !looksLikeEmail(value)) {
    return `${label} does not look like an email address`
  }

  if (field.type === "number") {
    const parsed = asNumber(value)
    if (parsed === null) return `${label} must be a number`
    const config = (field.config ?? {}) as Record<string, unknown>
    const min = config.min
    const max = config.max
    if (min !== undefined && min !== null && parsed < Number(min)) {
      return `${label} must be ${min} or more`
    }
    if (max !== undefined && max !== null && parsed > Number(max)) {
      return `${label} must be ${max} or less`
    }
  }

  return null
}

/**
 * What one occupant is actually asked.
 *
 * The lead occupant is the buyer, so whatever the buyer is asked elsewhere
 * is struck off their list; everyone else is a different person and keeps
 * being asked their own email. This is the single rule the panel renders by
 * and the gate validates by, so a hidden field can never be one the funnel
 * still refuses to pay without.
 */
export function fieldsAskedOf(
  fields: GuestFormField[],
  index: number,
  identity: BuyerIdentity,
): GuestFormField[] {
  if (index !== 0) return fields
  return fields.filter((field) => !identity.covers.has(field.key))
}

/**
 * The occupants with a card of their own.
 *
 * An occupant earns one by being asked something. The buyer usually is not:
 * their answers come from the buyer step or the account, and their name with
 * them. The exception is an account that carries no name at all, where the
 * step is the only thing left that can ask for one, and skipping their card
 * would leave `checkStayAnswers` demanding a name no field on the screen
 * collects.
 */
export function guestCardIndexes(
  item: Pick<SelectedAccommodationItem, "guestForm" | "guestCount">,
  { requireGuestNames, identity = NO_BUYER_IDENTITY }: StayCheckOptions,
): number[] {
  const fields = guestFieldsOf(item.guestForm)
  const indexes: number[] = []
  for (let index = 0; index < item.guestCount; index += 1) {
    if (
      asksNameOf(index, { requireGuestNames, identity }) ||
      fieldsAskedOf(fields, index, identity).length > 0
    ) {
      indexes.push(index)
    }
  }
  return indexes
}

/** Whether this booking has a single question left for the buyer to answer. */
export function stayAsksAnything(
  item: Pick<SelectedAccommodationItem, "guestForm" | "guestCount">,
  options: StayCheckOptions,
): boolean {
  return (
    bookerFieldsAsked(item.guestForm, options.identity ?? NO_BUYER_IDENTITY)
      .length > 0 || guestCardIndexes(item, options).length > 0
  )
}

/** The booking-wide questions still worth putting on screen. */
export function bookerFieldsAsked(
  form: AccommodationGuestForm | null | undefined,
  identity: BuyerIdentity,
): GuestFormField[] {
  return bookerFieldsOf(form).filter((field) => !identity.covers.has(field.key))
}

/**
 * Whether this occupant is asked to type a name.
 *
 * The lead occupant is the buyer, so their name comes from wherever the
 * buyer is known and is not typed here. When nothing knows it, the step asks
 * after all: a name the funnel requires and no field collects is a checkout
 * that cannot be finished.
 */
function asksNameOf(
  index: number,
  { requireGuestNames, identity }: Required<StayCheckOptions>,
): boolean {
  if (!requireGuestNames) return false
  return index > 0 || !identity.namesLeadGuest
}

interface StayCheckOptions {
  requireGuestNames: boolean
  /**
   * What the checkout answers on the buyer's behalf. Defaults to nothing,
   * which is the pre-derivation behaviour and what every caller outside the
   * checkout provider wants.
   */
  identity?: BuyerIdentity
}

/** The first problem in one booked room, or null when it is ready to buy. */
export function checkStayAnswers(
  item: Pick<
    SelectedAccommodationItem,
    "guestForm" | "bookerAnswers" | "guests" | "guestCount"
  >,
  { requireGuestNames, identity = NO_BUYER_IDENTITY }: StayCheckOptions,
): GuestFormProblem | null {
  const form = item.guestForm

  for (const field of bookerFieldsAsked(form, identity)) {
    const message = checkField(field, item.bookerAnswers)
    if (message) return { field: field.key, guestIndex: null, message }
  }

  const guestFields = guestFieldsOf(form)
  for (let index = 0; index < item.guestCount; index += 1) {
    const guest = item.guests[index]
    // In a direct sale the buyer's name is typed a step later than this
    // one. Refusing here would bounce them back to a screen that does not
    // have the field on it.
    if (
      asksNameOf(index, { requireGuestNames, identity }) &&
      !guest?.name?.trim()
    ) {
      return {
        field: "name",
        guestIndex: index,
        message: `Guest ${index + 1} needs a name`,
      }
    }
    for (const field of fieldsAskedOf(guestFields, index, identity)) {
      const message = checkField(field, guest?.answers ?? {})
      if (message) return { field: field.key, guestIndex: index, message }
    }
  }

  return null
}

/** How many of a room's people are fully answered for. Drives the counter. */
export function completeGuestCount(
  item: Pick<SelectedAccommodationItem, "guestForm" | "guests" | "guestCount">,
  { requireGuestNames, identity = NO_BUYER_IDENTITY }: StayCheckOptions,
): number {
  const fields = guestFieldsOf(item.guestForm)
  let complete = 0
  for (let index = 0; index < item.guestCount; index += 1) {
    const guest = item.guests[index]
    const named =
      !asksNameOf(index, { requireGuestNames, identity }) ||
      !!guest?.name?.trim()
    const answered = fieldsAskedOf(fields, index, identity).every(
      (field) => !checkField(field, guest?.answers ?? {}),
    )
    if (named && answered) complete += 1
  }
  return complete
}

/** The first room in the cart that is not ready, or null. */
export function firstIncompleteStay(
  items: Array<
    Pick<
      SelectedAccommodationItem,
      "guestForm" | "bookerAnswers" | "guests" | "guestCount"
    >
  >,
  options: StayCheckOptions,
): GuestFormProblem | null {
  for (const item of items) {
    const problem = checkStayAnswers(item, options)
    if (problem) return problem
  }
  return null
}

/**
 * Guests as they travel to the server.
 *
 * Mirrors `normalise_guests` on the backend: a slot with neither a name nor
 * an answer is the empty row the checkout renders for a party that has not
 * been filled in, and is not a person. A guest with answers but no name is
 * kept, because whether that is acceptable is `require_guest_names`'s
 * decision and not this function's.
 */
export function guestsForWire(
  guests: Array<{ name: string; answers: GuestAnswers }>,
): Array<{ name: string; answers: GuestAnswers }> {
  return guests
    .map((guest) => ({
      // Both halves defaulted: these entries can come back off a saved cart,
      // where an older shape had no `answers` and a hand-edited one may have
      // no `name`. Neither is worth throwing a stay away over.
      name: (guest.name ?? "").trim(),
      answers: guest.answers ?? {},
    }))
    .filter((guest) => guest.name || Object.keys(guest.answers).length > 0)
}
