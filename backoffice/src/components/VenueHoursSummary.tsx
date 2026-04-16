import type { VenueWeeklyHourRef } from "@/client"

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

interface Props {
  hours: VenueWeeklyHourRef[] | undefined
  className?: string
}

function formatTime(t: string | null | undefined): string {
  if (!t) return ""
  return t.length >= 5 ? t.slice(0, 5) : t
}

export function VenueHoursSummary({ hours, className }: Props) {
  if (!hours || hours.length === 0) {
    return (
      <p className={className ?? "text-xs text-muted-foreground"}>
        No weekly hours set for this venue.
      </p>
    )
  }

  const byDay = new Map(hours.map((h) => [h.day_of_week, h]))

  return (
    <div
      className={
        className ??
        "grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground"
      }
    >
      {DAY_LABELS.map((label, idx) => {
        const entry = byDay.get(idx)
        const closed = !entry || entry.is_closed
        return (
          <div key={label} className="contents">
            <span className="font-medium text-foreground">{label}</span>
            <span>
              {closed
                ? "Closed"
                : `${formatTime(entry?.open_time)} – ${formatTime(entry?.close_time)}`}
            </span>
          </div>
        )
      })}
    </div>
  )
}
