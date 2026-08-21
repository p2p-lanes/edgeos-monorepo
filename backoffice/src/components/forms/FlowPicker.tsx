import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"

import { SalesFlowsService } from "@/client"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { salesFlowsQueryKey } from "@/lib/salesFlowQueries"

interface FlowPickerProps {
  popupId: string
  value: string
  onChange: (flowId: string) => void
  disabled?: boolean
  /**
   * Narrow the list to flows of this type. Anything whose recipients end
   * up filing an application needs "application"; a coupon does not,
   * because discounting a sale is something every flow does.
   */
  restrictTo?: "application"
  /** What this flow decides, in the operator's words. */
  hint?: string
}

/**
 * Which flow a thing belongs to.
 *
 * `restrictTo="application"` for anything whose recipients end up filing
 * an application — an invite, a group. A direct sale produces none, so
 * choosing one would land nowhere; the API refuses it, and offering it
 * here would only produce that error.
 */
export function FlowPicker({
  popupId,
  value,
  onChange,
  disabled = false,
  restrictTo,
  hint,
}: FlowPickerProps) {
  const { data } = useQuery({
    queryKey: salesFlowsQueryKey(popupId),
    queryFn: () => SalesFlowsService.listSalesFlows({ popupId, limit: 100 }),
    enabled: !!popupId,
  })

  const flows = restrictTo
    ? (data?.results ?? []).filter((f) => f.type === restrictTo)
    : (data?.results ?? [])

  // Start on the default flow, which is where every invite landed people
  // before it could say otherwise.
  useEffect(() => {
    if (value || flows.length === 0) return
    onChange((flows.find((f) => f.is_default) ?? flows[0]).id)
  }, [flows, value, onChange])

  if (flows.length === 0) {
    return (
      <p className="px-1 text-muted-foreground text-sm">
        {restrictTo === "application"
          ? "This gathering has no flow that takes applications, so there is nowhere to send anyone."
          : "This gathering has no sales flow yet."}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 px-1">
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger aria-label="Sales flow">
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
      <p className="text-muted-foreground text-xs">
        {hint ?? "The recipient fills in this flow's form and gets its emails."}
      </p>
    </div>
  )
}
