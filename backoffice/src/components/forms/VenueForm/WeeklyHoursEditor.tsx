import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Clock } from "lucide-react"
import { useEffect, useState } from "react"

import {
  EventVenuesService,
  type VenueWeeklyHourInput,
  type VenueWeeklyHourRef,
} from "@/client"
import { InlineSection } from "@/components/ui/inline-form"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { Switch } from "@/components/ui/switch"
import { TimePicker } from "@/components/ui/time-picker"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

// Days of week (backend: 0 = Monday ... 6 = Sunday)
const DAYS_OF_WEEK: { value: number; label: string; short: string }[] = [
  { value: 0, label: "Monday", short: "Mon" },
  { value: 1, label: "Tuesday", short: "Tue" },
  { value: 2, label: "Wednesday", short: "Wed" },
  { value: 3, label: "Thursday", short: "Thu" },
  { value: 4, label: "Friday", short: "Fri" },
  { value: 5, label: "Saturday", short: "Sat" },
  { value: 6, label: "Sunday", short: "Sun" },
]

interface WeeklyHoursEditorProps {
  venueId: string
  initial: VenueWeeklyHourRef[] | undefined
}

function buildInitialWeek(
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

export function WeeklyHoursEditor({ venueId, initial }: WeeklyHoursEditorProps) {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const [hours, setHours] = useState<VenueWeeklyHourInput[]>(() =>
    buildInitialWeek(initial),
  )

  useEffect(() => {
    setHours(buildInitialWeek(initial))
  }, [initial])

  const saveMutation = useMutation({
    mutationFn: () =>
      EventVenuesService.setWeeklyHours({
        venueId,
        requestBody: { hours },
      }),
    onSuccess: () => {
      showSuccessToast("Weekly hours saved")
      queryClient.invalidateQueries({ queryKey: ["event-venues", venueId] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateDay = (
    day: number,
    patch: Partial<VenueWeeklyHourInput>,
  ) => {
    setHours((prev) =>
      prev.map((h) => (h.day_of_week === day ? { ...h, ...patch } : h)),
    )
  }

  return (
    <InlineSection title="Weekly hours">
      <div className="space-y-2 py-3">
        {DAYS_OF_WEEK.map((day) => {
          const entry = hours.find((h) => h.day_of_week === day.value)!
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
        <div className="flex justify-end pt-2">
          <LoadingButton
            type="button"
            size="sm"
            loading={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            Save weekly hours
          </LoadingButton>
        </div>
      </div>
    </InlineSection>
  )
}
