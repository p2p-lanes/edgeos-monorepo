"use client"

import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { DurationUnit } from "../lib/useEventScheduling"

interface DurationPickerProps {
  value: number
  unit: DurationUnit
  onChange: (next: { value: number; unit: DurationUnit }) => void
  disabled?: boolean
}

export function DurationPicker({
  value,
  unit,
  onChange,
  disabled,
}: DurationPickerProps) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={1}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          onChange({ value: Number.isNaN(n) ? 0 : n, unit })
        }}
        className="w-24"
      />
      <Select
        value={unit}
        disabled={disabled}
        onValueChange={(v) => {
          const next = v as DurationUnit
          if (next === unit) return
          const totalMinutes = unit === "hours" ? value * 60 : value
          onChange({
            unit: next,
            value:
              next === "hours"
                ? Math.max(1, Math.round(totalMinutes / 60))
                : Math.max(1, Math.round(totalMinutes)),
          })
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="minutes">{t("events.form.minutes")}</SelectItem>
          <SelectItem value="hours">{t("events.form.hours")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
