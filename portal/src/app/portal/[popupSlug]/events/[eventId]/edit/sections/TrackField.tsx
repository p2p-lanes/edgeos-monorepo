"use client"

import { useTranslation } from "react-i18next"

import type { TrackPublic } from "@/client"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface TrackFieldProps {
  tracks: TrackPublic[]
  value: string
  onChange: (next: string) => void
}

const NONE_VALUE = "__none__"

export function TrackField({ tracks, value, onChange }: TrackFieldProps) {
  const { t } = useTranslation()

  if (tracks.length === 0) return null

  return (
    <div className="space-y-2">
      <Label>{t("events.form.track_label")}</Label>
      <Select
        value={value || NONE_VALUE}
        onValueChange={(v) => onChange(v === NONE_VALUE ? "" : v)}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t("events.form.track_placeholder")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>
            {t("events.form.no_track_option")}
          </SelectItem>
          {tracks.map((tr) => (
            <SelectItem key={tr.id} value={tr.id}>
              {tr.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
