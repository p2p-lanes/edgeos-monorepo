import { Workflow } from "lucide-react"

interface SalesFlowScopeBannerProps {
  flowName: string
}

/**
 * Makes the edit scope explicit: this form edits one flow, not the event.
 * Fields shown as "Inherited" here still follow the event's own settings.
 */
export function SalesFlowScopeBanner({ flowName }: SalesFlowScopeBannerProps) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
      <Workflow className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="text-sm">
        <p className="font-medium">Editing sales flow: {flowName}</p>
        <p className="text-muted-foreground">
          Changes here apply only to this flow. Fields left as Inherited follow
          the event's configuration.
        </p>
      </div>
    </div>
  )
}
