"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface TimePickerProps {
  /** 24-hour value, "HH:mm" (e.g. "09:30"). Empty string = no selection. */
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** Minute granularity shown in the dropdown. Defaults to 5. */
  step?: 1 | 5 | 10 | 15 | 30
  className?: string
  id?: string
}

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"))

/**
 * Consistent time picker built from shadcn Selects — replaces the native
 * <input type="time"> widget whose column-scroll popup clashes with the
 * rest of the UI.
 *
 * Value format is "HH:mm" (24h). Use with DateTimePicker for a full
 * datetime input.
 */
export function TimePicker({
  value,
  onChange,
  disabled,
  step = 5,
  className,
  id,
}: TimePickerProps) {
  const [hh = "", mm = ""] = (value || "").split(":")

  const minutes = Array.from(
    { length: Math.ceil(60 / step) },
    (_, i) => String(i * step).padStart(2, "0"),
  )

  const emit = (nextHh: string, nextMm: string) => {
    if (!nextHh && !nextMm) {
      onChange("")
      return
    }
    onChange(`${nextHh || "00"}:${nextMm || "00"}`)
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Select
        value={hh}
        onValueChange={(v) => emit(v, mm)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-[72px]">
          <SelectValue placeholder="--" />
        </SelectTrigger>
        <SelectContent className="max-h-60">
          {HOURS.map((h) => (
            <SelectItem key={h} value={h}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-sm text-muted-foreground">:</span>
      <Select
        value={mm}
        onValueChange={(v) => emit(hh, v)}
        disabled={disabled}
      >
        <SelectTrigger className="w-[72px]">
          <SelectValue placeholder="--" />
        </SelectTrigger>
        <SelectContent className="max-h-60">
          {minutes.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
