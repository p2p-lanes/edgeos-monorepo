import { useQuery } from "@tanstack/react-query"
import { CircleAlert, Workflow } from "lucide-react"

import { type SalesFlowPublic, SalesFlowsService } from "@/client"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

interface FlowScopeBarProps {
  popupId: string
  flows: SalesFlowPublic[]
  activeFlowId: string | undefined
  onSelect: (flowId: string) => void
  isLoading?: boolean
  /** What this page edits, in the operator's words. "checkout steps". */
  resource: string
}

/**
 * Says whose things are on screen, on every flow-scoped page.
 *
 * Always the same control in the same place, so the answer to "what am I
 * working on" is learned once. It does NOT hide itself when a gathering has
 * a single flow: the question does not stop existing because the answer is
 * obvious, and a control that appears only sometimes teaches nothing.
 *
 * When the flow cannot sell, the bar says so. Configuring the emails of a
 * flow that reaches nobody is the expensive mistake this prevents.
 */
export function FlowScopeBar({
  popupId,
  flows,
  activeFlowId,
  onSelect,
  isLoading = false,
  resource,
}: FlowScopeBarProps) {
  const { data: readiness } = useQuery({
    queryKey: ["sales-flows", "readiness", { popupId }],
    queryFn: () => SalesFlowsService.listSalesFlowReadiness({ popupId }),
    enabled: !!popupId,
  })

  if (isLoading) return <Skeleton className="h-14 w-full" />
  if (flows.length === 0) return null

  const blockers =
    readiness?.find((r) => r.flow_id === activeFlowId)?.blockers ?? []
  const isBlocked = blockers.length > 0

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-4 py-3 ${
        isBlocked
          ? "border-destructive/40 bg-destructive/5"
          : "border-primary/30 bg-primary/5"
      }`}
    >
      <Workflow
        className={`h-4 w-4 shrink-0 ${
          isBlocked ? "text-destructive" : "text-primary"
        }`}
      />
      <Select value={activeFlowId} onValueChange={onSelect}>
        <SelectTrigger
          className="h-8 w-56 bg-background"
          aria-label="Sales flow"
        >
          <SelectValue placeholder="Choose a sales flow" />
        </SelectTrigger>
        <SelectContent>
          {flows.map((flow) => (
            <SelectItem key={flow.id} value={flow.id}>
              {flow.name}
              {flow.is_default ? " (default)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-sm">
        These {resource} belong to this flow. Another flow has its own.
      </p>
      {isBlocked && (
        <p className="flex w-full items-center gap-1.5 text-destructive text-xs">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" />
          This flow cannot sell yet, so nothing here reaches a buyer.
        </p>
      )}
    </div>
  )
}
