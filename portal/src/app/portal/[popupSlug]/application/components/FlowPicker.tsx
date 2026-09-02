"use client"

import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { usePortalSalesFlows } from "@/hooks/usePortalSalesFlows"
import { cn } from "@/lib/utils"

interface FlowPickerProps {
  popupId: string
  /** Called once a flow is resolved — either the sole flow (auto-selected,
   * no picker shown) or the flow the visitor picked. */
  onSelect: (flowId: string) => void
  selectedFlowId?: string | null
}

/**
 * Portal FlowPicker (sdd/sales-flows G0, task 9.4).
 *
 * Shown only when a popup has more than one `portal_listed`
 * `type=application` sales flow — a single-flow popup renders exactly as
 * before this slice (the sole flow auto-selects via `onSelect`, no UI).
 */
export function FlowPicker({
  popupId,
  onSelect,
  selectedFlowId,
}: FlowPickerProps) {
  const { t } = useTranslation()
  const { data: flows, isLoading } = usePortalSalesFlows(popupId)

  const singleFlow = flows && flows.length === 1 ? flows[0] : null
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run when the resolved single flow's id changes — `singleFlow` itself is a new object every render (derived from `flows`), so including it would re-run on every unrelated re-render.
  useEffect(() => {
    if (singleFlow) {
      onSelect(singleFlow.id)
    }
  }, [singleFlow?.id, onSelect])

  if (isLoading || !flows || flows.length <= 1) {
    return null
  }

  const sorted = [...flows].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  return (
    <div className="space-y-3 rounded-2xl border bg-card p-6">
      <div>
        <h2 className="text-lg font-semibold">
          {t("application.flow_picker_title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("application.flow_picker_description")}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {sorted.map((flow) => (
          <button
            key={flow.id}
            type="button"
            onClick={() => onSelect(flow.id)}
            className={cn(
              "rounded-xl border p-4 text-left transition-colors hover:border-primary",
              selectedFlowId === flow.id && "border-primary bg-primary/5",
            )}
          >
            <span className="font-medium">{flow.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
