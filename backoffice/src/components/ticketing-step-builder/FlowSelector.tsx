import { useQuery } from "@tanstack/react-query"

import { SalesFlowsService } from "@/client"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface FlowSelectorProps {
  popupId: string
  value: string | undefined
  onChange: (flowId: string) => void
}

/**
 * Sales-flow picker for the ticketing-step builder toolbar (sdd/sales-flows
 * slice 8). The step list is flow-scoped: a flow that owns any step row
 * uses ONLY its own list, else falls back to the popup-shared tier (see
 * `ticketing_steps_crud.find_for_flow`). Single-flow popups render exactly
 * one option — the default flow — so the selector is a no-op for them.
 */
export function FlowSelector({ popupId, value, onChange }: FlowSelectorProps) {
  const { data } = useQuery({
    queryKey: ["sales-flows", popupId],
    queryFn: () => SalesFlowsService.listSalesFlows({ popupId, limit: 100 }),
    enabled: !!popupId,
  })

  const flows = data?.results ?? []
  if (flows.length <= 1) return null

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full" aria-label="Sales flow">
        <SelectValue placeholder="Select a sales flow" />
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
  )
}
