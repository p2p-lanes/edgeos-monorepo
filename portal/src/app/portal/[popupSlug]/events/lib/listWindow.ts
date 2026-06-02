import { dayBoundsInTz } from "@edgeos/shared-events"

function dayStr(s: string | null | undefined) {
  const m = s?.slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/)
  return m ? m[0] : null
}

function dayKeyInTz(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

export function eventListWindowForPopup(
  popupStartDate: string | null | undefined,
  popupEndDate: string | null | undefined,
  timezone: string,
  now = new Date(),
) {
  const startDay = dayStr(popupStartDate)
  const endDay = dayStr(popupEndDate)
  if (startDay && endDay) {
    const today = dayKeyInTz(now, timezone)
    const queryStartDay =
      startDay <= today && today <= endDay ? today : startDay

    // dayBoundsInTz returns [dayStart, dayEnd): the end of ``endDay`` is
    // midnight of the following local day, which keeps the last day's events in.
    const { start } = dayBoundsInTz(queryStartDay, timezone)
    const { end } = dayBoundsInTz(endDay, timezone)
    return {
      startAfter: start.toISOString(),
      startBefore: end.toISOString(),
    }
  }

  const start = new Date(now)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 180)
  return {
    startAfter: start.toISOString(),
    startBefore: end.toISOString(),
  }
}
