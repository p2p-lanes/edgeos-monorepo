"use client"

import { useTranslation } from "react-i18next"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface CapacityFieldProps {
  value: string
  onChange: (next: string) => void
  venueMaxCapacity: number | null
}

export function CapacityField({
  value,
  onChange,
  venueMaxCapacity,
}: CapacityFieldProps) {
  const { t } = useTranslation()

  const exceedsCapacity =
    venueMaxCapacity != null &&
    value !== "" &&
    Number.parseInt(value, 10) > venueMaxCapacity

  return (
    <div className="space-y-2">
      <Label htmlFor="max">{t("events.form.max_participants_label")}</Label>
      <Input
        id="max"
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          venueMaxCapacity != null
            ? t("events.form.max_participants_placeholder_capacity", {
                capacity: venueMaxCapacity,
              })
            : t("events.form.max_participants_placeholder_unlimited")
        }
      />
      {exceedsCapacity && (
        <p className="text-xs text-destructive">
          {t("events.form.exceeds_capacity_warning", {
            capacity: venueMaxCapacity ?? 0,
          })}
        </p>
      )}
    </div>
  )
}
