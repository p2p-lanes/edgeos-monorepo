"use client"

import { useId } from "react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  computeEventEnd,
  DURATION_PRESETS,
  type DurationDraft,
  draftFromMinutes,
  parseDurationDraft,
  splitMinutes,
} from "../lib/eventDuration"

interface DurationPickerProps {
  /** Raw Hours / Minutes text, owned by `useEventScheduling`. */
  draft: DurationDraft
  onChange: (next: DurationDraft) => void
  /** Event start (UTC ISO). Empty hides the live "Ends at" line. */
  startIso: string
  /** Event timezone, so the end time reads like the start time field. */
  timeZone: string
  disabled?: boolean
}

export function DurationPicker({
  draft,
  onChange,
  startIso,
  timeZone,
  disabled,
}: DurationPickerProps) {
  const { t, i18n } = useTranslation()
  const id = useId()
  const hoursId = `${id}-hours`
  const minutesId = `${id}-minutes`
  const messageId = `${id}-message`

  const parsed = parseDurationDraft(draft)
  const totalMinutes = parsed.ok ? parsed.minutes : null
  const error = parsed.ok ? null : parsed.error
  const end =
    totalMinutes != null && startIso
      ? computeEventEnd(Date.parse(startIso), totalMinutes, timeZone)
      : null

  const presetLabel = (minutes: number) => {
    const parts = splitMinutes(minutes)
    if (parts.hours === 0) {
      return t("events.form.duration_preset_minutes", {
        minutes: parts.minutes,
      })
    }
    if (parts.minutes === 0) {
      return t("events.form.duration_preset_hours", { hours: parts.hours })
    }
    return t("events.form.duration_preset_hours_minutes", parts)
  }

  const endLabel = (() => {
    if (!end) return null
    if (end.dayOffset === 0) {
      return t("events.form.duration_ends_at", { time: end.time })
    }
    const date = new Intl.DateTimeFormat(i18n.language, {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(end.endMs))
    return t("events.form.duration_ends_at_on_date", { time: end.time, date })
  })()

  // Once the draft is valid, re-split it on blur so "90" minutes or "1.5"
  // hours settle as 1 h 30 min. The total never changes.
  const normalize = () => {
    if (totalMinutes == null) return
    const canonical = draftFromMinutes(totalMinutes)
    if (
      canonical.hours !== draft.hours.trim() ||
      canonical.minutes !== draft.minutes.trim()
    ) {
      onChange(canonical)
    }
  }

  return (
    <div className="space-y-2">
      <fieldset
        aria-label={t("events.form.duration_presets_label")}
        className="flex flex-wrap gap-1.5"
      >
        {DURATION_PRESETS.map((minutes) => {
          const active = totalMinutes === minutes
          return (
            <button
              key={minutes}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onChange(draftFromMinutes(minutes))}
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium disabled:pointer-events-none disabled:opacity-50",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background text-foreground hover:bg-muted",
              )}
            >
              {presetLabel(minutes)}
            </button>
          )
        })}
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label
            htmlFor={hoursId}
            className="text-xs font-normal text-muted-foreground"
          >
            {t("events.form.hours")}
          </Label>
          <Input
            id={hoursId}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={draft.hours}
            disabled={disabled}
            aria-invalid={!!error}
            aria-describedby={messageId}
            onChange={(e) => onChange({ ...draft, hours: e.target.value })}
            onBlur={normalize}
          />
        </div>
        <div className="space-y-1">
          <Label
            htmlFor={minutesId}
            className="text-xs font-normal text-muted-foreground"
          >
            {t("events.form.minutes")}
          </Label>
          <Input
            id={minutesId}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={draft.minutes}
            disabled={disabled}
            aria-invalid={!!error}
            aria-describedby={messageId}
            onChange={(e) => onChange({ ...draft, minutes: e.target.value })}
            onBlur={normalize}
          />
        </div>
      </div>
      {error ? (
        <p id={messageId} role="alert" className="text-xs text-destructive">
          {t(`events.form.duration_error_${error}`)}
        </p>
      ) : endLabel ? (
        <p
          id={messageId}
          aria-live="polite"
          className="text-xs text-muted-foreground"
        >
          {endLabel}
        </p>
      ) : null}
    </div>
  )
}
