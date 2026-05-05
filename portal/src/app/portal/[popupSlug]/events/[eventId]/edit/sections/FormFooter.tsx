"use client"

import { Loader2, Save } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"

interface FormFooterProps {
  onCancel: () => void
  canSubmit: boolean
  isSubmitting: boolean
}

export function FormFooter({
  onCancel,
  canSubmit,
  isSubmitting,
}: FormFooterProps) {
  const { t } = useTranslation()

  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="outline" onClick={onCancel}>
        {t("events.form.cancel_button")}
      </Button>
      <Button type="submit" disabled={!canSubmit}>
        {isSubmitting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Save className="mr-2 h-4 w-4" />
        )}
        {t("events.form.save_button")}
      </Button>
    </div>
  )
}
