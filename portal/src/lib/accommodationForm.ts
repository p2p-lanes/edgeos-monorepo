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

import type { AccommodationGuestForm, GuestFormField } from "@/client"
import type { SelectedAccommodationItem } from "@/types/checkout"

export type GuestAnswers = Record<string, unknown>

export interface GuestFormProblem {
  /** The field's key, so the input can be pointed at. */
  field: string
  /** Zero-based occupant, or null for the booker. */
  guestIndex: number | null
  message: string
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

/** The first problem in one booked room, or null when it is ready to buy. */
export function checkStayAnswers(
  item: Pick<
    SelectedAccommodationItem,
    "guestForm" | "bookerAnswers" | "guests" | "guestCount"
  >,
  { requireGuestNames }: { requireGuestNames: boolean },
): GuestFormProblem | null {
  const form = item.guestForm

  for (const field of bookerFieldsOf(form)) {
    const message = checkField(field, item.bookerAnswers)
    if (message) return { field: field.key, guestIndex: null, message }
  }

  const guestFields = guestFieldsOf(form)
  for (let index = 0; index < item.guestCount; index += 1) {
    const guest = item.guests[index]
    if (requireGuestNames && !guest?.name?.trim()) {
      return {
        field: "name",
        guestIndex: index,
        message: `Guest ${index + 1} needs a name`,
      }
    }
    for (const field of guestFields) {
      const message = checkField(field, guest?.answers ?? {})
      if (message) return { field: field.key, guestIndex: index, message }
    }
  }

  return null
}

/** How many of a room's people are fully answered for. Drives the counter. */
export function completeGuestCount(
  item: Pick<SelectedAccommodationItem, "guestForm" | "guests" | "guestCount">,
  { requireGuestNames }: { requireGuestNames: boolean },
): number {
  const fields = guestFieldsOf(item.guestForm)
  let complete = 0
  for (let index = 0; index < item.guestCount; index += 1) {
    const guest = item.guests[index]
    const named = !requireGuestNames || !!guest?.name?.trim()
    const answered = fields.every(
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
  options: { requireGuestNames: boolean },
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
    .map((guest) => ({ name: guest.name.trim(), answers: guest.answers ?? {} }))
    .filter((guest) => guest.name || Object.keys(guest.answers).length > 0)
}
