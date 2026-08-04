"use client"

import { useTranslation } from "react-i18next"

import type { MyGroupPublic } from "@/client"
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
  groupId: string
  onGroupChange: (next: string) => void
  eligibleGroups: MyGroupPublic[]
}

export function VisibilityField({
  value,
  onChange,
  groupId,
  onGroupChange,
  eligibleGroups,
}: VisibilityFieldProps) {
  const { t } = useTranslation()

  return (
    <>
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
        <p className="text-xs text-muted-foreground">
          {t("events.form.visibility_helper")}
        </p>
      </div>

      {value === "private" && (
        <div className="space-y-2">
          <Label htmlFor="group-picker-edit">
            {t("events.form.share_with_group_label")}
          </Label>
          {eligibleGroups.length > 0 ? (
            <>
              <Select
                value={groupId}
                onValueChange={(v) => onGroupChange(v === "__none__" ? "" : v)}
              >
                <SelectTrigger id="group-picker-edit" className="w-full">
                  <SelectValue
                    placeholder={t("events.form.share_with_group_placeholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    {t("events.form.share_with_group_placeholder")}
                  </SelectItem>
                  {eligibleGroups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("events.form.share_with_group_helper")}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("events.form.no_eligible_groups")}
            </p>
          )}
        </div>
      )}
    </>
  )
}
