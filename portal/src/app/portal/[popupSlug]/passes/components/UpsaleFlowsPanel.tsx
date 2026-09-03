"use client"

import Link from "next/link"
import { useTranslation } from "react-i18next"
import { usePortalUpsaleFlows } from "@/hooks/usePortalUpsaleFlows"

interface UpsaleFlowsPanelProps {
  popupSlug: string
  popupId: string | undefined
}

/**
 * Portal upsale catalog surface (sdd/sales-flows G0 #2/#3, D8, task 13.3).
 *
 * Renders nothing while loading or when the human has no eligible upsale
 * flows (eligibility is server-side: >=1 APPROVED payment in the popup —
 * see `usePortalUpsaleFlows`). Each entry links to that flow's own
 * checkout page, which enforces the same eligibility gate server-side.
 */
export function UpsaleFlowsPanel({
  popupSlug,
  popupId,
}: UpsaleFlowsPanelProps) {
  const { t } = useTranslation()
  const { data: flows } = usePortalUpsaleFlows(popupId)

  if (!flows || flows.length === 0) {
    return null
  }

  return (
    <div className="mb-6 space-y-3 rounded-2xl border bg-card p-6">
      <div>
        <h2 className="text-lg font-semibold">{t("passes.upsale_title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("passes.upsale_description")}
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
