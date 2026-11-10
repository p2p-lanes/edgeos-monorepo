const LOCALE_MAP: Record<string, string> = {
  en: "en-US",
  es: "es-ES",
  zh: "zh-CN",
  is: "is-IS",
}

function getLocale(): string {
  if (typeof window === "undefined") return "en-US"
  const lang = localStorage.getItem("portal_language") ?? "en"
  return LOCALE_MAP[lang] ?? "en-US"
}

/**
 * Parse a date string as a local date (ignoring timezone).
 * "2026-05-10T00:00:00Z" → May 10 in any timezone, not May 9 in UTC-3.
 */
const parseLocalDate = (date: string): Date => {
  const d = new Date(date)
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/**
 * Epoch milliseconds for a date string, or `null` when it is missing or
 * unparseable. Gatherings may have blank start/end dates, so callers that
 * compare or sort popup dates must handle `null` instead of feeding `NaN`
 * into comparisons.
 */
export const toTimestamp = (date?: string | null): number | null => {
  if (!date) return null
  const time = new Date(date).getTime()
  return Number.isNaN(time) ? null : time
}

/**
 * Sort comparator for optional dates: missing dates always go last,
 * regardless of direction.
 */
export const compareOptionalDates = (
  a: string | null | undefined,
  b: string | null | undefined,
  direction: "asc" | "desc" = "asc",
): number => {
  const timeA = toTimestamp(a)
  const timeB = toTimestamp(b)
  if (timeA === null && timeB === null) return 0
  if (timeA === null) return 1
  if (timeB === null) return -1
  return direction === "asc" ? timeA - timeB : timeB - timeA
}

/** Formats a date, returning "" when it is missing or invalid. */
export const formatDate = (
  date?: string | null,
  formatString: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  },
) => {
  if (!date || toTimestamp(date) === null) return ""
  return parseLocalDate(date).toLocaleDateString(getLocale(), formatString)
}

/**
 * Formats a start/end pair as "start - end". When only one side is set it
 * returns that date alone, and "" when neither is set, so callers can hide
 * the date line entirely.
 */
export const formatDateRange = (
  startDate?: string | null,
  endDate?: string | null,
  formatString?: Intl.DateTimeFormatOptions,
) => {
  const start = formatDate(startDate, formatString)
  const end = formatDate(endDate, formatString)
  if (start && end) return `${start} - ${end}`
  return start || end
}
