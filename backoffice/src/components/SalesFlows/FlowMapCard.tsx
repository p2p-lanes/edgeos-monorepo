import { Link } from "@tanstack/react-router"
import { AlertTriangle, CircleAlert, CircleCheck, EyeOff } from "lucide-react"

import type { SalesFlowPublic, SalesFlowReadiness } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { BLOCKER_TEXT, warningText } from "@/lib/salesFlowReadiness"

/**
 * One flow on the map (sdd/sales-flows-rediseno slice 8).
 *
 * The card shows STATE, not configuration. The table it replaces listed
 * name, slug, type and visibility, and a flow with an empty checkout looked
 * exactly like a working one there. What an operator needs to see first is
 * whether the flow can take money today.
 */

interface FlowMapCardProps {
  flow: SalesFlowPublic
  readiness?: SalesFlowReadiness
}

export function FlowMapCard({ flow, readiness }: FlowMapCardProps) {
  const blockers = readiness?.blockers ?? []
  const warnings = readiness?.warnings ?? []
  const isBlocked = blockers.length > 0

  return (
    // The whole card is the target. A card that only reacts on its title
    // makes the operator hunt for the one live pixel in it.
    <Link
      to="/sales-flows/$id/edit"
      params={{ id: flow.id }}
      className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Card
        className={`h-full transition-colors ${
          isBlocked
            ? "border-destructive/40 hover:border-destructive/70"
            : "hover:border-primary/50"
        }`}
      >
        <CardContent className="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{flow.name}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {flow.slug}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {flow.is_default && <Badge variant="secondary">Default</Badge>}
              <Badge variant="outline" className="capitalize">
                {flow.type}
              </Badge>
            </div>
          </div>

          {readiness && (
            <p className="text-xs text-muted-foreground">
              {readiness.enabled_step_count} step
              {readiness.enabled_step_count === 1 ? "" : "s"} ·{" "}
              {readiness.offered_product_count} product
              {readiness.offered_product_count === 1 ? "" : "s"} on sale
              {flow.type === "application" &&
                ` · ${readiness.form_field_count} form question${
                  readiness.form_field_count === 1 ? "" : "s"
                }`}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            {blockers.map((code) => (
              <p
                key={code}
                className="flex items-start gap-1.5 text-xs text-destructive"
              >
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {BLOCKER_TEXT[code] ?? code}
              </p>
            ))}
            {warnings.map((code) => (
              <p
                key={code}
                className="flex items-start gap-1.5 text-xs text-muted-foreground"
              >
                {code === "unlisted" ? (
                  <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                )}
                {warningText(code, flow.type)}
              </p>
            ))}
            {readiness && !isBlocked && warnings.length === 0 && (
              <p className="flex items-center gap-1.5 text-xs text-success">
                <CircleCheck className="h-3.5 w-3.5 shrink-0" />
                Ready to sell
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
