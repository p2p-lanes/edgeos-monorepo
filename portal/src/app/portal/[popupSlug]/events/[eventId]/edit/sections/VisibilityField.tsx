"use client"

import { useTranslation } from "react-i18next"

import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type Visibility = "public" | "private" | "unlisted"

interface VisibilityFieldProps {
  value: Visibility
  onChange: (next: Visibility) => void
}

export function VisibilityField({ value, onChange }: VisibilityFieldProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-2">
      <Label>{t("events.form.visibility_label")}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as Visibility)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="public">
            {t("events.form.visibility_public")}
          </SelectItem>
          <SelectItem value="private">
            {t("events.form.visibility_private_short")}
          </SelectItem>
          <SelectItem value="unlisted">
            {t("events.form.visibility_unlisted_short")}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
