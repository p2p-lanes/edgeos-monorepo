const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  year: "numeric",
})

function parseDate(iso: string | null): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatDateRange(
  start: string | null,
  end: string | null,
): string {
  const s = parseDate(start)
  const e = parseDate(end)
  if (s && e) return `${DATE_FORMATTER.format(s)} - ${DATE_FORMATTER.format(e)}`
  if (s) return DATE_FORMATTER.format(s)
  if (e) return DATE_FORMATTER.format(e)
  return "Dates TBD"
}

export function formatShortDate(iso: string | null): string {
  const d = parseDate(iso)
  if (!d) return "Coming soon"
  return DATE_FORMATTER.format(d)
}
