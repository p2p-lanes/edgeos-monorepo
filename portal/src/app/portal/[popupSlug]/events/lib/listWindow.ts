import { dayBoundsInTz } from "@edgeos/shared-events"

function dayStr(s: string | null | undefined) {
  const m = s?.slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/)
  return m ? m[0] : null
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
    // Anchor the window to the popup's full booking range — same as the
    // calendar and day views. We deliberately do NOT clamp the start to
    // "today": an event earlier in the popup (e.g. yesterday, or earlier
    // today once the local date rolls over) is still a valid published event
    // and stays visible everywhere else, so clamping silently dropped it from
    // the list only. The list's ``autoScrollToUpcoming`` already scrolls past
    // events out of the initial viewport, so the "starts at today" feel is
    // preserved without hiding anything.
    //
    // dayBoundsInTz returns [dayStart, dayEnd): the end of ``endDay`` is
    // midnight of the following local day, which keeps the last day's events in.
    const { start } = dayBoundsInTz(startDay, timezone)
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
