import type { VenueWeeklyHourRef } from "@/client"
import { cn } from "@/lib/utils"

type Slot = {
  openLabel: string
  closeLabel: string
}

type DayData = {
  idx: number
  label: string
  slots: Slot[]
  closed: boolean
}

const DAY_LABELS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function formatTime(t: string | null | undefined): string {
  if (!t) return ""
  return t.length >= 5 ? t.slice(0, 5) : t
}

function buildWeek(hours: VenueWeeklyHourRef[]): DayData[] {
  const byDay = new Map<number, VenueWeeklyHourRef[]>()
  for (const h of hours) {
    const list = byDay.get(h.day_of_week) ?? []
    list.push(h)
    byDay.set(h.day_of_week, list)
  }
  return DAY_LABELS_SHORT.map((label, idx) => {
    const entries = byDay.get(idx) ?? []
    const open = entries
      .filter((e) => !e.is_closed && e.open_time && e.close_time)
      .sort((a, b) => (a.open_time ?? "").localeCompare(b.open_time ?? ""))
    const slots: Slot[] = open.map((e) => ({
      openLabel: formatTime(e.open_time),
      closeLabel: formatTime(e.close_time),
    }))
    return {
      idx,
      label,
      slots,
      closed: slots.length === 0,
    }
  })
}

interface Props {
  hours: VenueWeeklyHourRef[] | undefined
}

export function VenueHoursPreview({ hours }: Props) {
  if (!hours || hours.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Open anytime — no weekly schedule configured.
      </p>
    )
  }

  const week = buildWeek(hours)

  return (
    <div className="rounded-lg border bg-card divide-y overflow-hidden">
      {week.map((d) => (
        <div
          key={d.idx}
          className={cn(
            "flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors hover:bg-muted/60",
            d.closed && "text-muted-foreground",
          )}
        >
          <span className="font-medium">{d.label}</span>
          <span className="tabular-nums text-right">
            {d.closed
              ? "Closed"
              : d.slots
                  .map((s) => `${s.openLabel} – ${s.closeLabel}`)
                  .join(", ")}
          </span>
        </div>
      ))}
    </div>
  )
}
