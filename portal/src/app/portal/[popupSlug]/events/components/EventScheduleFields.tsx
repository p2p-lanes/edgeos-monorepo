"use client"

import type { SlotOption } from "@edgeos/shared-events"
import { Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { DurationUnit } from "../lib/useEventScheduling"
import { DurationPicker } from "./DurationPicker"

interface EventScheduleFieldsProps {
  // Date
  dateStr: string
  onDateChange: (next: string) => void
  isDateOutsidePopupWindow?: (d: Date) => boolean
  isVenueClosedOnDay?: (d: Date) => boolean
  popupWindowLabel: string | null

  // Time
  timeStr: string
  onTimeChange: (next: string) => void

  // Duration
  durationValue: number
  durationUnit: DurationUnit
  onDurationChange: (next: { value: number; unit: DurationUnit }) => void

  // Validation / state
  venueId: string
  withinOpenHours: boolean
  availability: "idle" | "checking" | "ok" | "conflict"
  /** True once `getPortalAvailability` has returned for the current day. */
  availabilityLoaded: boolean
  startOptionsCount: number
  /**
   * Up to 3 bookable starts close to the current pick. Rendered as
   * click-to-apply pills under the conflict / outside-hours error.
   */
  nearbyStartOptions?: SlotOption[]
  /** Called with the chosen suggestion's HH:mm label. */
  onSuggestionPick?: (label: string) => void
  /** When true, the inputs render in a disabled state (e.g. unbookable venue). */
  disabled?: boolean
}

export function EventScheduleFields({
  dateStr,
  onDateChange,
  isDateOutsidePopupWindow,
  isVenueClosedOnDay,
  popupWindowLabel,
  timeStr,
  onTimeChange,
  durationValue,
  durationUnit,
  onDurationChange,
  venueId,
  withinOpenHours,
  availability,
  availabilityLoaded,
  startOptionsCount,
  nearbyStartOptions,
  onSuggestionPick,
  disabled,
}: EventScheduleFieldsProps) {
  const { t } = useTranslation()

  const showSuggestions =
    !!venueId &&
    !!timeStr &&
    !disabled &&
    (!withinOpenHours || availability === "conflict") &&
    !!nearbyStartOptions &&
    nearbyStartOptions.length > 0 &&
    !!onSuggestionPick

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="date">{t("events.form.date_label")}</Label>
        <DatePicker
          id="date"
          value={dateStr}
          onChange={onDateChange}
          disabled={disabled}
          disabledDays={isDateOutsidePopupWindow}
          closedDays={
            isVenueClosedOnDay
              ? (d) =>
                  !(isDateOutsidePopupWindow?.(d) ?? false) &&
                  isVenueClosedOnDay(d)
              : undefined
          }
        />
        {popupWindowLabel && (
          <p className="text-xs text-muted-foreground">
            {t("events.form.popup_window_hint", { window: popupWindowLabel })}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="start">{t("events.form.start_time_label")}</Label>
            {availability === "checking" && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
          </div>
          <Input
            id="start"
            type="time"
            value={timeStr}
            disabled={disabled}
            onChange={(e) => onTimeChange(e.target.value.slice(0, 5))}
            className={cn(
              "w-full",
              venueId &&
                timeStr &&
                (!withinOpenHours || availability === "conflict")
                ? "border-destructive focus-visible:ring-destructive/40"
                : "",
            )}
            required
          />
          {venueId && timeStr && !withinOpenHours && (
            <p className="text-xs text-destructive">
              {t("events.form.start_time_outside_venue_hours")}
            </p>
          )}
          {venueId &&
            timeStr &&
            withinOpenHours &&
            availability === "conflict" && (
              <p className="text-xs text-destructive">
                {t("events.form.start_time_conflict")}
              </p>
            )}
          {showSuggestions && nearbyStartOptions && onSuggestionPick && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                {t("events.form.try_nearby_slots")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {nearbyStartOptions.map((opt) => (
                  <button
                    key={opt.isoUtc}
                    type="button"
                    onClick={() => onSuggestionPick(opt.label)}
                    className="inline-flex items-center rounded-full border border-input bg-background px-2.5 py-0.5 text-xs font-medium text-foreground hover:bg-muted"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label>{t("events.form.duration_label")}</Label>
          <DurationPicker
            value={durationValue}
            unit={durationUnit}
            onChange={onDurationChange}
            disabled={disabled}
          />
        </div>
      </div>
      {venueId && startOptionsCount === 0 && availabilityLoaded && (
        <p className="text-xs text-destructive">
          {t("events.form.no_venue_open_hours")}
        </p>
      )}
    </>
  )
}
