import { Workflow } from "lucide-react"

interface SalesFlowScopeBannerProps {
  flowName: string
}

/**
 * Makes the edit scope explicit: this form edits one flow, not the event.
 *
 * It used to add that fields left as "Inherited" follow the event. Since
 * sdd/sales-flows-rediseno slice 7 a flow stores its own values and there
 * is nothing to inherit, so saying so would be describing a mechanism that
 * no longer exists.
 */
export function SalesFlowScopeBanner({ flowName }: SalesFlowScopeBannerProps) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
      <Workflow className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="text-sm">
        <p className="font-medium">Editing sales flow: {flowName}</p>
        <p className="text-muted-foreground">
          Changes here apply only to this flow. No other flow sees them.
        </p>
      </div>
    </div>
  )
}
