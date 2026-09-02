import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CircleSlash } from "lucide-react"

import { type SalesFlowPublic, SalesFlowsService } from "@/client"
import { Button } from "@/components/ui/button"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

/**
 * Taking a sales flow out of circulation, and putting it back.
 *
 * A flow somebody has already applied through cannot be deleted — that would
 * throw away what they did — and there was nothing else to do with it. It kept
 * its place in the portal and kept taking new applicants.
 *
 * Closing is not deleting and is not next to it. Deleting is permanent and
 * refuses when there is history; this is reversible and is for exactly the
 * flows deleting refuses.
 */
export function FlowClosureCard({ flow }: { flow: SalesFlowPublic }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const closed = flow.status === "closed"

  const mutation = useMutation({
    mutationFn: (status: "closed" | null) =>
      SalesFlowsService.updateSalesFlow({
        flowId: flow.id,
        requestBody: { status },
      }),
    onSuccess: (_data, status) => {
      queryClient.invalidateQueries({ queryKey: ["sales-flows"] })
      showSuccessToast(status ? "Sales flow closed" : "Sales flow reopened")
    },
    onError: createErrorHandler(showErrorToast),
  })

  if (closed) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3">
        <CircleSlash className="h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">This sales flow is closed</p>
          <p className="text-sm text-muted-foreground">
            Buyers cannot reach it and it takes nothing new. Everything it
            already sold is untouched.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(null)}
        >
          Reopen
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Close this sales flow</p>
        <p className="text-sm text-muted-foreground">
          It stops appearing in the portal and stops taking anything new.
          Applications and payments it already has are kept, and you can reopen
          it.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate("closed")}
      >
        Close
      </Button>
    </div>
  )
}
