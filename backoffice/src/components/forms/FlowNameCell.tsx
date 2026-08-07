import { useQuery } from "@tanstack/react-query"

import { SalesFlowsService } from "@/client"

interface FlowNameCellProps {
  popupId: string | null
  flowId: string | undefined
}

/**
 * The name of the flow a row belongs to.
 *
 * A list of things that each land somewhere different has to say where, or
 * two rows that behave differently look identical. Reads the same cached
 * flow list every flow-scoped screen uses, so this costs no extra request.
 */
export function FlowNameCell({ popupId, flowId }: FlowNameCellProps) {
  const { data } = useQuery({
    queryKey: ["sales-flows", { popupId }],
    queryFn: () =>
      SalesFlowsService.listSalesFlows({ popupId: popupId!, limit: 100 }),
    enabled: !!popupId,
  })

  if (!flowId) return <span className="text-muted-foreground text-sm">—</span>

  const flow = data?.results?.find((f) => f.id === flowId)
  return (
    <span className="text-sm">
      {flow?.name ?? <span className="text-muted-foreground">Loading…</span>}
    </span>
  )
}
