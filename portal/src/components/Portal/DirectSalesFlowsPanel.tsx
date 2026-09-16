"use client"

import Link from "next/link"
import { useTranslation } from "react-i18next"
import { usePortalDirectSalesFlows } from "@/hooks/usePortalDirectSalesFlows"

interface DirectSalesFlowsPanelProps {
  popupSlug: string
  popupId: string | undefined
}

export function DirectSalesFlowsPanel({
  popupSlug,
  popupId,
}: DirectSalesFlowsPanelProps) {
  const { t } = useTranslation()
  const { data: flows } = usePortalDirectSalesFlows(popupId)

  if (!flows || flows.length === 0) {
    return null
  }

  return (
    <div className="space-y-3 rounded-2xl border bg-card p-6">
      <div>
        <h2 className="text-lg font-semibold">
          {t("portal.direct_sales_title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("portal.direct_sales_description")}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {flows.map((flow) => (
          <Link
            key={flow.id}
            href={`/checkout/${popupSlug}/${flow.slug}`}
            className="rounded-xl border p-4 text-left transition-colors hover:border-primary"
          >
            <span className="font-medium">{flow.name}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
