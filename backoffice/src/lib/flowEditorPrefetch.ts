import type { QueryClient } from "@tanstack/react-query"
import {
  allFormFieldsQueryOptions,
  allFormSectionsQueryOptions,
  type FlowEditorScope,
  rememberedOrDefaultFlow,
  salesFlowsQueryOptions,
  ticketingStepsQueryOptions,
} from "./salesFlowQueries"

export async function prefetchFlowEditor(
  queryClient: QueryClient,
  scope: FlowEditorScope | undefined,
  destination: string,
  flowId?: string,
  popupId = scope?.popupId,
) {
  if (
    !scope?.isCurrent() ||
    popupId !== scope.popupId ||
    !["/ticketing-steps", "/form-builder"].includes(destination)
  )
    return
  try {
    const listing = await queryClient.fetchQuery(
      salesFlowsQueryOptions(scope.popupId, scope),
    )
    if (!scope.isCurrent()) return
    const flows = listing.results.filter(
      (flow) =>
        flow.popup_id === scope.popupId && flow.tenant_id === scope.tenantId,
    )
    // Explicit invalid links must not warm a different flow. Only unnamed
    // sidebar navigation follows the same remembered/default policy as the page.
    const flow = flowId
      ? flows.find((item) => item.id === flowId)
      : rememberedOrDefaultFlow(flows, scope.popupId)
    if (!flow) return
    if (destination === "/ticketing-steps") {
      await queryClient.prefetchQuery(
        ticketingStepsQueryOptions(scope.popupId, flow.id, scope),
      )
    } else {
      await Promise.all([
        queryClient.prefetchQuery(
          allFormFieldsQueryOptions(scope.popupId, flow.id, scope),
        ),
        queryClient.prefetchQuery(
          allFormSectionsQueryOptions(scope.popupId, flow.id, scope),
        ),
      ])
    }
  } catch {
    // Intent is best-effort; the destination owns errors and retry controls.
  }
}
