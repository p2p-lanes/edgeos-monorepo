/**
 * Build deep links that pre-fill an event in the major web calendars.
 *
 * These formats are officially documented:
 * - Google: https://developers.google.com/calendar/docs/gadgets-to-addons#addtocalendar
 * - Outlook Live: https://learn.microsoft.com/en-us/previous-versions/office/developer/server-technologies/aa563468(v=exchg.140)
 * - Yahoo: widely-used ``calendar.yahoo.com/?v=60`` pattern
 *
 * Apple Calendar / iCal has no web URL — it reads a downloaded ``.ics``
 * file, which we serve from the backend. The caller drives that path.
 */

export interface CalendarLinkInput {
  title: string
  /** ISO datetime strings — same format the backend returns. */
  startIso: string
  endIso: string
  description?: string | null
  location?: string | null
}

/** "YYYYMMDDTHHMMSSZ" — Google/Yahoo format. */
function toCompactUtc(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  )
}

export function googleCalendarUrl(input: CalendarLinkInput): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates: `${toCompactUtc(input.startIso)}/${toCompactUtc(input.endIso)}`,
  })
  if (input.description) params.set("details", input.description)
  if (input.location) params.set("location", input.location)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export function outlookCalendarUrl(input: CalendarLinkInput): string {
  // Outlook accepts full ISO datetimes directly (no reformat).
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: input.title,
    startdt: input.startIso,
    enddt: input.endIso,
  })
  if (input.description) params.set("body", input.description)
  if (input.location) params.set("location", input.location)
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`
}

export function office365CalendarUrl(input: CalendarLinkInput): string {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: input.title,
    startdt: input.startIso,
    enddt: input.endIso,
  })
  if (input.description) params.set("body", input.description)
  if (input.location) params.set("location", input.location)
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`
}

export function yahooCalendarUrl(input: CalendarLinkInput): string {
  const params = new URLSearchParams({
    v: "60",
    title: input.title,
    st: toCompactUtc(input.startIso),
    et: toCompactUtc(input.endIso),
  })
  if (input.description) params.set("desc", input.description)
  if (input.location) params.set("in_loc", input.location)
  return `https://calendar.yahoo.com/?${params.toString()}`
}
