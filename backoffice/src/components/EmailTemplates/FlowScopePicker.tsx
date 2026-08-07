import { useQuery } from "@tanstack/react-query"
import { Workflow } from "lucide-react"

import { SalesFlowsService } from "@/client"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface FlowScopePickerProps {
  popupId: string
  value: string | undefined
  onChange: (flowId: string) => void
}

/**
 * Which flow's mails you are looking at.
 *
 * Templates a sale produces belong to the flow that made the sale, so this
 * page edits one flow at a time. It stays on screen even when a gathering
 * has a single flow: the point is to say WHOSE template is on the page, and
 * a control that hides itself answers that only when the answer is already
 * obvious.
 */
export function FlowScopePicker({
  popupId,
  value,
  onChange,
}: FlowScopePickerProps) {
  const { data } = useQuery({
    queryKey: ["sales-flows", { popupId }],
    queryFn: () => SalesFlowsService.listSalesFlows({ popupId, limit: 100 }),
    enabled: !!popupId,
  })

  const flows = data?.results ?? []
  if (flows.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/30 px-4 py-3">
      <Workflow className="h-4 w-4 shrink-0 text-muted-foreground" />
      <Label htmlFor="email-flow-scope" className="text-sm">
        Sales flow
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="email-flow-scope" className="w-64" size="sm">
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
      <p className="text-xs text-muted-foreground">
        These emails go out for sales made through this flow only.
      </p>
    </div>
  )
}
