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

export const toDate = (date: string) => {
  return new Date(date).toLocaleDateString(getLocale(), {
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
  return new Date(date).toLocaleDateString(getLocale(), formatString)
}
