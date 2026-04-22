import type { RecurrenceRule } from "@/client"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const
type WeekdayCode = (typeof WEEKDAY_CODES)[number]

export const WEEKDAY_LABELS: Record<WeekdayCode, string> = {
  MO: "M",
  TU: "T",
  WE: "W",
  TH: "T",
  FR: "F",
  SA: "S",
  SU: "S",
}

type RepeatMode = "none" | "daily" | "weekly" | "monthly"
type RepeatEnd = "never" | "count" | "until"

export interface RepeatState {
  mode: RepeatMode
  interval: number
  byDay: WeekdayCode[]
  end: RepeatEnd
  count: number
  until: string // YYYY-MM-DD
}

const DEFAULT_REPEAT: RepeatState = {
  mode: "none",
  interval: 1,
  byDay: [],
  end: "never",
  count: 10,
  until: "",
}

export function parseRruleToState(
  rrule: string | null | undefined,
): RepeatState {
  if (!rrule) return { ...DEFAULT_REPEAT }
  const kv: Record<string, string> = {}
  for (const part of rrule.split(";")) {
    const [k, v] = part.split("=")
    if (k && v) kv[k.toUpperCase()] = v
  }
  const freq = kv.FREQ
  const mode: RepeatMode =
    freq === "DAILY"
      ? "daily"
      : freq === "WEEKLY"
        ? "weekly"
        : freq === "MONTHLY"
          ? "monthly"
          : "none"
  const interval = kv.INTERVAL ? parseInt(kv.INTERVAL, 10) || 1 : 1
  const byDay =
    kv.BYDAY != null
      ? (kv.BYDAY.split(",")
          .map((c) => c.toUpperCase())
          .filter((c): c is WeekdayCode =>
            (WEEKDAY_CODES as readonly string[]).includes(c),
          ) as WeekdayCode[])
      : []
  let end: RepeatEnd = "never"
  let count = DEFAULT_REPEAT.count
  let until = ""
  if (kv.COUNT) {
    end = "count"
    count = parseInt(kv.COUNT, 10) || count
  } else if (kv.UNTIL) {
    end = "until"
    // Accept YYYYMMDDTHHMMSSZ or YYYYMMDD
    const raw = kv.UNTIL.replace("Z", "")
    if (raw.length >= 8) {
      until = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
    }
  }
  return { mode, interval, byDay, end, count, until }
}

export function buildRecurrence(state: RepeatState): RecurrenceRule | null {
  if (state.mode === "none") return null
  const freq =
    state.mode === "daily"
      ? "DAILY"
      : state.mode === "weekly"
        ? "WEEKLY"
        : "MONTHLY"
  const rule: RecurrenceRule = {
    freq,
    interval: Math.max(1, state.interval || 1),
  }
  if (freq === "WEEKLY" && state.byDay.length > 0) {
    rule.by_day = state.byDay
  }
  if (state.end === "count") {
    rule.count = Math.max(1, state.count || 1)
  } else if (state.end === "until" && state.until) {
    const [y, m, d] = state.until.split("-").map(Number)
    rule.until = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).toISOString()
  }
  return rule
}

interface RepeatPickerProps {
  value: RepeatState
  onChange: (next: RepeatState) => void
  disabled?: boolean
}

export function RepeatPicker({ value, onChange, disabled }: RepeatPickerProps) {
  const update = (patch: Partial<RepeatState>) => {
    if (disabled) return
    onChange({ ...value, ...patch })
  }

  const unitLabel =
    value.mode === "daily"
      ? value.interval === 1
        ? "day"
        : "days"
      : value.mode === "weekly"
        ? value.interval === 1
          ? "week"
          : "weeks"
        : value.mode === "monthly"
          ? value.interval === 1
            ? "month"
            : "months"
          : ""

  return (
    <div className="flex w-full flex-col items-end gap-3">
      <Select
        value={value.mode}
        onValueChange={(v) => update({ mode: v as RepeatMode })}
        disabled={disabled}
      >
        <SelectTrigger className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Does not repeat</SelectItem>
          <SelectItem value="daily">Daily</SelectItem>
          <SelectItem value="weekly">Weekly</SelectItem>
          <SelectItem value="monthly">Monthly</SelectItem>
        </SelectContent>
      </Select>

      {value.mode !== "none" && (
        <div className="flex w-full max-w-xs flex-col items-end gap-2 rounded-md border bg-card/40 p-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Every</span>
            <Input
              type="number"
              min={1}
              max={999}
              value={value.interval}
              onChange={(e) =>
                update({ interval: parseInt(e.target.value, 10) || 1 })
              }
              className="w-16"
              disabled={disabled}
            />
            <span className="text-xs text-muted-foreground">{unitLabel}</span>
          </div>

          {value.mode === "weekly" && (
            <div className="flex gap-1">
              {WEEKDAY_CODES.map((code) => {
                const active = value.byDay.includes(code)
                return (
                  <button
                    key={code}
                    type="button"
                    disabled={disabled}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs disabled:opacity-50",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background text-muted-foreground",
                    )}
                    onClick={() =>
                      update({
                        byDay: active
                          ? value.byDay.filter((c) => c !== code)
                          : [...value.byDay, code],
                      })
                    }
                  >
                    {WEEKDAY_LABELS[code]}
                  </button>
                )
              })}
            </div>
          )}

          <div className="flex flex-col gap-1 text-xs">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="repeat-end"
                disabled={disabled}
                checked={value.end === "never"}
                onChange={() => update({ end: "never" })}
              />
              Never
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="repeat-end"
                disabled={disabled}
                checked={value.end === "count"}
                onChange={() => update({ end: "count" })}
              />
              After{" "}
              <Input
                type="number"
                min={1}
                max={1000}
                value={value.count}
                onChange={(e) =>
                  update({
                    end: "count",
                    count: parseInt(e.target.value, 10) || 1,
                  })
                }
                className="h-7 w-20"
                disabled={disabled}
              />{" "}
              occurrences
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="repeat-end"
                disabled={disabled}
                checked={value.end === "until"}
                onChange={() => update({ end: "until" })}
              />
              On{" "}
              <DatePicker
                value={value.until}
                onChange={(v) => update({ end: "until", until: v })}
                className="h-7 w-40"
                placeholder="Pick date"
                disabled={disabled}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
