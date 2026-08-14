import { useQuery } from "@tanstack/react-query"
import { GitCompareArrows } from "lucide-react"

import { type SalesFlowPublic, SalesFlowsService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { diffAgainstBaseline, summarizeDiff } from "@/lib/salesFlowDiff"

/**
 * What this door changed about the door it was copied from.
 *
 * Every flow but the first is born as a copy of the default one, so almost
 * every setting below this card says exactly what the original says. Reading
 * the editor top to bottom cannot tell you which of the thirty-three were
 * decisions and which were inherited. This can, in a few lines.
 */
export function FlowDiffCard({
  flow,
  popupId,
}: {
  flow: SalesFlowPublic
  popupId: string
}) {
  const { data: flows } = useQuery({
    queryKey: ["sales-flows", { popupId }],
    queryFn: () => SalesFlowsService.listSalesFlows({ popupId, limit: 100 }),
  })

  // The default flow is the baseline because it is what the backend copies
  // from (`seed_config_from_popup`). There is no stored lineage to consult.
  const baseline = flows?.results?.find((f) => f.is_default) ?? null
  const diff = diffAgainstBaseline(flow, baseline)
  const summary = summarizeDiff(diff)

  // The default flow itself has nothing to be compared against: it is the
  // thing everything else is compared to.
  if (summary === null) {
    return (
      <div className="rounded-xl border bg-muted/30 p-4">
        <p className="text-sm text-muted-foreground">
          This is the way in every new one starts from. What you set here
          becomes the starting point for the next door you open.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-muted/30 p-4">
      <div className="flex items-start gap-3">
        <GitCompareArrows className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-sm font-medium">{summary}</p>

          {diff.differences.length > 0 && (
            <dl className="space-y-1.5">
              {diff.differences.map((d) => (
                <div
                  key={`${d.section}-${d.label}`}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm"
                >
                  <dt className="text-muted-foreground">{d.label}</dt>
                  <dd className="font-medium">
                    <Badge variant="secondary" className="font-normal">
                      {d.value}
                    </Badge>
                  </dd>
                  <dd className="text-xs text-muted-foreground">
                    {diff.baselineName}: {d.baselineValue}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {/* Said out loud rather than implied, because "configured exactly
          like Attendee" on a door that sells one product would otherwise
          read as "identical", and it is not. */}
          <p className="text-xs text-muted-foreground">
            Compares settings only. What each door puts on sale is in its steps.
          </p>
        </div>
      </div>
    </div>
  )
}
