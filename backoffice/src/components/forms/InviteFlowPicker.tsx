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

interface InviteFlowPickerProps {
  popupId: string
  value: string
  onChange: (flowId: string) => void
  disabled?: boolean
}

/**
 * Which flow an invite lands its recipient in.
 *
 * Only application flows are offered. Redeeming an invite creates an
 * application, so an invite into a direct sale would redeem into nothing —
 * the API refuses it, and offering it here would only produce that error.
 */
export function InviteFlowPicker({
  popupId,
  value,
  onChange,
  disabled = false,
}: InviteFlowPickerProps) {
  const { data } = useQuery({
    queryKey: ["sales-flows", { popupId }],
    queryFn: () => SalesFlowsService.listSalesFlows({ popupId, limit: 100 }),
    enabled: !!popupId,
  })

  const flows = (data?.results ?? []).filter((f) => f.type === "application")

  // Start on the default flow, which is where every invite landed people
  // before it could say otherwise.
  useEffect(() => {
    if (value || flows.length === 0) return
    onChange((flows.find((f) => f.is_default) ?? flows[0]).id)
  }, [flows, value, onChange])

  if (flows.length === 0) {
    return (
      <p className="px-1 text-muted-foreground text-sm">
        This gathering has no flow that takes applications, so an invite has
        nowhere to send anyone.
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
        The recipient fills in this flow's form and gets its emails. It cannot
        be changed once the invite exists.
      </p>
    </div>
  )
}
