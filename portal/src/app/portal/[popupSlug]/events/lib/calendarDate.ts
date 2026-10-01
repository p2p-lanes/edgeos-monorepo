/** A calendar-cell Date: its local fields represent the gathering's day. */
export function todayInTimezone(timezone: string, now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)
  return new Date(value("year"), value("month") - 1, value("day"))
}
