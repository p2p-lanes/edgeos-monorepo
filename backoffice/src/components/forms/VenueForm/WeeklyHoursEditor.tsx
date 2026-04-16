import { Clock } from "lucide-react"

import type { VenueWeeklyHourInput, VenueWeeklyHourRef } from "@/client"
import { InlineSection } from "@/components/ui/inline-form"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { TimePicker } from "@/components/ui/time-picker"

const DAYS_OF_WEEK: { value: number; label: string; short: string }[] = [
  { value: 0, label: "Monday", short: "Mon" },
  { value: 1, label: "Tuesday", short: "Tue" },
  { value: 2, label: "Wednesday", short: "Wed" },
  { value: 3, label: "Thursday", short: "Thu" },
  { value: 4, label: "Friday", short: "Fri" },
  { value: 5, label: "Saturday", short: "Sat" },
  { value: 6, label: "Sunday", short: "Sun" },
]

export function buildInitialWeeklyHours(
  initial: VenueWeeklyHourRef[] | undefined,
): VenueWeeklyHourInput[] {
  return DAYS_OF_WEEK.map((day) => {
    const existing = initial?.find((h) => h.day_of_week === day.value)
    if (existing) {
      return {
        day_of_week: day.value,
        open_time: existing.open_time ?? "09:00",
        close_time: existing.close_time ?? "17:00",
        is_closed: existing.is_closed,
      }
    }
    return {
      day_of_week: day.value,
      open_time: "09:00",
      close_time: "17:00",
      is_closed: true,
    }
  })
}

interface WeeklyHoursEditorProps {
  value: VenueWeeklyHourInput[]
  onChange: (hours: VenueWeeklyHourInput[]) => void
}

export function WeeklyHoursEditor({ value, onChange }: WeeklyHoursEditorProps) {
  const updateDay = (day: number, patch: Partial<VenueWeeklyHourInput>) => {
    onChange(value.map((h) => (h.day_of_week === day ? { ...h, ...patch } : h)))
  }

  return (
    <InlineSection title="Weekly hours">
      <div className="space-y-2 py-3">
        {DAYS_OF_WEEK.map((day) => {
          const entry = value.find((h) => h.day_of_week === day.value)
          if (!entry) return null
          return (
            <div
              key={day.value}
              className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2"
            >
              <div className="flex items-center gap-2 w-24 shrink-0">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{day.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id={`closed-${day.value}`}
                  checked={!entry.is_closed}
                  onCheckedChange={(checked) =>
                    updateDay(day.value, { is_closed: !checked })
                  }
                />
                <Label
                  htmlFor={`closed-${day.value}`}
                  className="text-xs text-muted-foreground"
                >
                  {entry.is_closed ? "Closed" : "Open"}
                </Label>
              </div>
              {!entry.is_closed && (
                <div className="flex items-center gap-2">
                  <TimePicker
                    value={entry.open_time ?? ""}
                    onChange={(v) => updateDay(day.value, { open_time: v })}
                  />
                  <span className="text-sm text-muted-foreground">to</span>
                  <TimePicker
                    value={entry.close_time ?? ""}
                    onChange={(v) => updateDay(day.value, { close_time: v })}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </InlineSection>
  )
}
