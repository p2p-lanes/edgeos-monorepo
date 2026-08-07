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

interface ApplicationFlowPickerProps {
  popupId: string
  value: string
  onChange: (flowId: string) => void
  disabled?: boolean
}

/**
 * Which flow something sends people into — an invite, a group, anything
 * whose recipients end up filing an application.
 *
 * Only application flows are offered. A direct sale produces no
 * application, so choosing one would land nowhere; the API refuses it, and
 * offering it here would only produce that error.
 */
export function ApplicationFlowPicker({
  popupId,
  value,
  onChange,
  disabled = false,
}: ApplicationFlowPickerProps) {
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
