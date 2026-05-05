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
  // No weekly_hours rows is a "no schedule configured" state, which the
  // backend treats as always-open. Say so explicitly so users don't read
  // it as "closed".
  if (!hours || hours.length === 0) {
    return (
      <p className={className ?? "text-xs text-muted-foreground"}>
        Open anytime — no weekly schedule configured.
      </p>
    )
  }

  // Group multiple open/close rows per weekday so split schedules (e.g.
  // 09-11 AND 17-21 on the same day) can be summarized as comma-joined
  // ranges instead of overwriting each other.
  const byDay = new Map<number, VenueWeeklyHourRef[]>()
  for (const h of hours) {
    const list = byDay.get(h.day_of_week) ?? []
    list.push(h)
    byDay.set(h.day_of_week, list)
  }

  return (
    <div
      className={
        className ??
        "grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground"
      }
    >
      {DAY_LABELS.map((label, idx) => {
        const entries = byDay.get(idx) ?? []
        const openSlots = entries
          .filter((e) => !e.is_closed && e.open_time && e.close_time)
          .sort((a, b) => (a.open_time ?? "").localeCompare(b.open_time ?? ""))
        return (
          <div key={label} className="contents">
            <span className="font-medium text-foreground">{label}</span>
            <span>
              {openSlots.length === 0
                ? "Closed"
                : openSlots
                    .map(
                      (s) =>
                        `${formatTime(s.open_time)} – ${formatTime(s.close_time)}`,
                    )
                    .join(", ")}
            </span>
          </div>
        )
      })}
    </div>
  )
}
