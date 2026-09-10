/**
 * Turning a stored booking into the things its page shows.
 *
 * All of it pure, because all of it is fiddly: which questions were asked of
 * whom, what a question was called at the time, and what to do with an answer
 * whose question has since been deleted.
 *
 * Everything here reads `form_snapshot`, never the step's current form. The
 * snapshot is the whole point: an operator who renames "Age" to "Age at
 * check-in" has not changed what a guest was asked last March, and a page
 * that relabelled the old answer would be quietly lying to whoever reads it.
 */

/** A guest-form field as the snapshot stored it. */
interface SnapshotField {
  key?: string
  label?: string
}

interface SnapshotSection {
  title?: string | null
  fields?: SnapshotField[]
}

export interface BookingFormSnapshot {
  booker?: SnapshotSection
  guests?: SnapshotSection & { mode?: string }
}

export interface AnswerRow {
  key: string
  label: string
  /** Already rendered. Empty string means the question went unanswered. */
  value: string
  /** True when the current snapshot has no field for this key. */
  orphaned?: boolean
}

export interface PersonBlock {
  id: string
  title: string
  /** The person's name, when there is one. */
  name?: string
  rows: AnswerRow[]
}

type Answers = Record<string, unknown>

interface BookingGuest {
  name?: string | null
  answers?: Answers | null
}

function fieldsOf(section: SnapshotSection | undefined): SnapshotField[] {
  return (section?.fields ?? []).filter((field) => !!field?.key)
}

/** The questions each occupant was asked, with `mode` resolved.
 *
 *  `same_as_booker` is the default and stores no fields of its own, so
 *  reading the guests section literally would show a page with answers and
 *  no questions to hang them on. */
export function guestFields(
  snapshot: BookingFormSnapshot | null | undefined,
): SnapshotField[] {
  const mode = snapshot?.guests?.mode ?? "same_as_booker"
  if (mode === "off") return []
  if (mode === "custom") return fieldsOf(snapshot?.guests)
  return fieldsOf(snapshot?.booker)
}

export function formatAnswer(value: unknown): string {
  if (value === null || value === undefined) return ""
  // "Yes"/"No", not "true": a ticked consent box is not a boolean to the
  // person reading this page.
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ")
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

/** One person's answers: the questions asked, then anything else on file.
 *
 *  The second half matters. A form that lost a question still has the answers
 *  it collected sitting in the row, and dropping them here would hide data
 *  the guest actually gave us. They are marked so the page can say why they
 *  have no proper label. */
function rowsFor(fields: SnapshotField[], answers: Answers): AnswerRow[] {
  const asked = fields.map((field) => ({
    key: field.key as string,
    label: field.label?.trim() || (field.key as string),
    value: formatAnswer(answers[field.key as string]),
  }))
  const known = new Set(asked.map((row) => row.key))
  const orphans = Object.keys(answers)
    .filter((key) => !known.has(key))
    .map((key) => ({
      key,
      label: key,
      value: formatAnswer(answers[key]),
      orphaned: true,
    }))
  return [...asked, ...orphans]
}

/**
 * Everyone this booking has something on file about.
 *
 * The booking contact comes first and is not the same person as guest 1,
 * even when it is: one is who we talk to about the room, the other is who
 * sleeps in it. The checkout asks them separately and this shows them
 * separately.
 *
 * A booking from before the guest form existed still produces guest blocks,
 * with names and no rows. Those names were always stored and were never
 * shown anywhere, which is its own small bug being fixed here.
 */
export function personBlocks(booking: {
  form_snapshot?: unknown
  booker_answers?: unknown
  guests?: unknown
}): PersonBlock[] {
  const snapshot = (booking.form_snapshot ?? null) as BookingFormSnapshot | null
  const bookerAnswers = (booking.booker_answers ?? {}) as Answers
  const guests = (
    Array.isArray(booking.guests) ? booking.guests : []
  ) as BookingGuest[]

  const blocks: PersonBlock[] = []

  const bookerRows = rowsFor(fieldsOf(snapshot?.booker), bookerAnswers)
  if (bookerRows.length > 0) {
    blocks.push({
      id: "booker",
      title: snapshot?.booker?.title?.trim() || "Booking contact",
      rows: bookerRows,
    })
  }

  const perGuest = guestFields(snapshot)
  guests.forEach((guest, index) => {
    const rows = rowsFor(perGuest, (guest.answers ?? {}) as Answers)
    const name = guest.name?.trim()
    if (!name && rows.length === 0) return
    blocks.push({
      id: `guest-${index}`,
      title: `Guest ${index + 1}`,
      name: name || undefined,
      rows,
    })
  })

  return blocks
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

/**
 * "Mon 1 Jun", from a plain calendar date.
 *
 * Built from the parts rather than from `new Date(iso)`: that parses a bare
 * date as UTC midnight, which renders as the day before anywhere west of
 * Greenwich. A check-in shown one day early is the kind of bug an operator
 * only finds at the front desk.
 */
export function formatStayDate(iso: string | null | undefined): string {
  if (!iso) return ""
  const [year, month, day] = iso.split("-").map(Number)
  if (!year || !month || !day) return iso
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return iso
  return `${WEEKDAYS[date.getDay()]} ${day} ${MONTHS[month - 1]}`
}

export function nightsLabel(nights: number): string {
  return nights === 1 ? "1 night" : `${nights} nights`
}

export interface Charge {
  subtotal?: string
  tax?: string
  total?: string
  currency?: string
}

/** The money, out of the snapshot frozen onto the booking. */
export function chargeOf(priceSnapshot: unknown): Charge | null {
  if (!priceSnapshot || typeof priceSnapshot !== "object") return null
  const snapshot = priceSnapshot as Record<string, unknown>
  const read = (key: string) =>
    snapshot[key] === null || snapshot[key] === undefined
      ? undefined
      : String(snapshot[key])
  const charge = {
    subtotal: read("subtotal"),
    tax: read("tax"),
    total: read("total"),
    currency: read("currency"),
  }
  return charge.total === undefined ? null : charge
}
