"use client"

import { X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Label } from "@/components/ui/label"

interface TopicTagsFieldProps {
  allowedTags: string[] | undefined
  value: string[]
  onChange: (next: string[]) => void
}

export function TopicTagsField({
  allowedTags,
  value,
  onChange,
}: TopicTagsFieldProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-2">
      <Label>{t("events.form.topic_label")}</Label>
      {allowedTags && allowedTags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {allowedTags.map((tag) => {
            const active = value.includes(tag)
            return (
              <button
                key={tag}
                type="button"
                onClick={() => {
                  if (active) onChange(value.filter((x) => x !== tag))
                  else onChange([...value, tag])
                }}
                className={
                  active
                    ? "inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-xs text-primary-foreground"
                    : "inline-flex items-center gap-1 rounded-full border border-input bg-background px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                }
              >
                {tag}
                {active && <X className="h-3 w-3" />}
              </button>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("events.form.no_tags_configured")}
        </p>
      )}
    </div>
  )
}
