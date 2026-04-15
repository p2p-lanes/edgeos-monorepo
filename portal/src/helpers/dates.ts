const LOCALE_MAP: Record<string, string> = {
  en: "en-US",
  es: "es-ES",
  zh: "zh-CN",
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

export const toDate = (date: string) => {
  return parseLocalDate(date).toLocaleDateString(getLocale(), {
    month: "long",
    day: "numeric",
  })
}

export const toDateRange = (startDate: string, endDate: string) => {
  return `${toDate(startDate)} - ${toDate(endDate)}`
}

export const formatDate = (
  date?: string,
  formatString: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  },
) => {
  if (!date) return ""
  return parseLocalDate(date).toLocaleDateString(getLocale(), formatString)
}
