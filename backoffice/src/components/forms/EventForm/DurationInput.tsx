import { useId } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  computeEventEnd,
  DURATION_PRESETS,
  type DurationDraft,
  type DurationError,
  draftFromMinutes,
  parseDurationDraft,
  splitMinutes,
} from "@/lib/events/eventDuration"
import { cn } from "@/lib/utils"

export const DURATION_ERROR_MESSAGES: Record<DurationError, string> = {
  required: "Enter a duration.",
  invalid: "Enter a valid duration in hours and minutes.",
  not_positive: "Duration must be greater than 0.",
}

function presetLabel(minutes: number): string {
  const { hours, minutes: rest } = splitMinutes(minutes)
  if (hours === 0) return `${rest} min`
  if (rest === 0) return `${hours} h`
  return `${hours} h ${rest} min`
}

interface DurationInputProps {
  /** Raw Hours / Minutes text as stored in the form. */
  draft: DurationDraft
  onChange: (next: DurationDraft) => void
  /** Event start (UTC ISO). Empty hides the live "Ends at" line. */
  startIso: string
  /** Event timezone, so the end time reads like the start time field. */
  timeZone: string
  disabled?: boolean
}

/**
 * Quick picks plus separate Hours / Minutes fields with a live end time.
 * Invalid input is kept as typed and reported; it is never clamped.
 */
export function DurationInput({
  draft,
  onChange,
  startIso,
  timeZone,
  disabled,
}: DurationInputProps) {
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

  const endLabel = (() => {
    if (!end) return null
    if (end.dayOffset === 0) return `Ends at ${end.time}`
    const date = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(end.endMs))
    return `Ends at ${end.time} on ${date}`
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
    <div className="flex w-[240px] flex-col items-end gap-2">
      <fieldset
        aria-label="Common durations"
        className="flex flex-wrap justify-end gap-1.5"
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
                "inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium shadow-sm transition-colors disabled:pointer-events-none disabled:opacity-50",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted",
              )}
            >
              {presetLabel(minutes)}
            </button>
          )
        })}
      </fieldset>
      <div className="grid w-full grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label
            htmlFor={hoursId}
            className="text-xs font-normal text-muted-foreground"
          >
            Hours
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
        <div className="flex flex-col gap-1">
          <Label
            htmlFor={minutesId}
            className="text-xs font-normal text-muted-foreground"
          >
            Minutes
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
        <p
          id={messageId}
          role="alert"
          className="text-right text-xs text-destructive"
        >
          {DURATION_ERROR_MESSAGES[error]}
        </p>
      ) : endLabel ? (
        <p
          id={messageId}
          aria-live="polite"
          className="text-right text-xs text-muted-foreground"
        >
          {endLabel}
        </p>
      ) : null}
    </div>
  )
}
