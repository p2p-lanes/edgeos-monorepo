import { useQuery } from "@tanstack/react-query"
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react"

import { SalesFlowsService } from "@/client"
import { BLOCKER_TEXT, warningText } from "@/lib/salesFlowReadiness"

/**
 * Where this way in stands, before any of its settings.
 *
 * An organiser opening a door does not arrive wanting to change a percentage.
 * They arrive wanting to know whether it works, and if not, what is stopping
 * it. That question had no answer on this screen: the flow map answered it
 * from a list, and the editor went straight to thirty-three fields.
 *
 * The wording is the flow map's, not a second opinion. One definition of
 * "this cannot sell", rendered in two places.
 */
export function FlowStandingCard({
  popupId,
  flowId,
  flowType,
}: {
  popupId: string
  flowId: string
  /** Some warnings mean something different depending on the kind of door. */
  flowType?: string
}) {
  const { data: readiness } = useQuery({
    queryKey: ["sales-flows", "readiness", { popupId }],
    queryFn: () => SalesFlowsService.listSalesFlowReadiness({ popupId }),
    enabled: !!popupId,
  })

  const mine = readiness?.find((r) => r.flow_id === flowId)
  if (!mine) return null

  const blockers = mine.blockers ?? []
  const warnings = mine.warnings ?? []

  if (blockers.length === 0 && warnings.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success-soft px-4 py-3">
        <CircleCheck className="h-4 w-4 shrink-0 text-success" />
        <p className="text-sm">
          This way in is ready. Buyers can reach it and pay through it today.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="border-b bg-muted/40 px-4 py-2.5 text-sm font-semibold">
        {blockers.length > 0
          ? "This way in cannot sell yet"
          : "This way in works, with something worth knowing"}
      </div>
      <ul className="divide-y">
        {blockers.map((code) => (
          <li key={code} className="flex items-start gap-3 px-4 py-3">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span className="text-sm">{BLOCKER_TEXT[code] ?? code}</span>
          </li>
        ))}
        {warnings.map((code) => (
          <li key={code} className="flex items-start gap-3 px-4 py-3">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span className="text-sm text-muted-foreground">
              {warningText(code, flowType)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
