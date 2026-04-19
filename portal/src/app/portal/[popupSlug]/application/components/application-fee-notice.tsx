"use client"

import { Info } from "lucide-react"
import { useTranslation } from "react-i18next"

interface ApplicationFeeNoticeProps {
  amount: string
}

export function ApplicationFeeNotice({ amount }: ApplicationFeeNoticeProps) {
  const { t } = useTranslation()
  return (
    <div className="flex w-full items-start gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm text-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-heading-secondary" />
      <div>
        <p className="font-semibold">{t("application.fee.required_title")}</p>
        <p className="mt-1 text-heading-secondary">
          {t("application.fee.required_description", { amount })}
        </p>
      </div>
    </div>
  )
}
