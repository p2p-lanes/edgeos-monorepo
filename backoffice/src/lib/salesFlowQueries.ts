import { CancelledError, queryOptions } from "@tanstack/react-query"
import {
  FormFieldsService,
  FormSectionsService,
  type SalesFlowPublic,
  SalesFlowsService,
  TicketingStepsService,
} from "@/client"

export function salesFlowsQueryKey(popupId: string | null | undefined) {
  return ["sales-flows", { popupId }] as const
}

export interface FlowEditorScope {
  tenantId: string
  popupId: string
  isCurrent: () => boolean
}

async function scopedRead<T>(
  scope: FlowEditorScope | undefined,
  read: () => Promise<T>,
): Promise<T> {
  if (scope && !scope.isCurrent()) throw new CancelledError({ revert: true })
  const result = await read()
  if (scope && !scope.isCurrent()) throw new CancelledError({ revert: true })
  return result
}

export function salesFlowsQueryOptions(
  popupId: string | null | undefined,
  scope?: FlowEditorScope,
) {
  return queryOptions({
    queryKey: salesFlowsQueryKey(popupId),
    queryFn: () =>
      scopedRead(scope, () =>
        SalesFlowsService.listSalesFlows({
          popupId: popupId!,
          limit: 100,
          ...(scope ? { xTenantId: scope.tenantId } : {}),
        }),
      ),
  })
}

export function ticketingStepsQueryOptions(
  popupId: string,
  flowId?: string,
  scope?: FlowEditorScope,
) {
  return queryOptions({
    queryKey: ["ticketing-steps", popupId, flowId] as const,
    queryFn: () =>
      scopedRead(scope, () =>
        TicketingStepsService.listTicketingSteps({
          popupId,
          salesFlowId: flowId,
          limit: 100,
          ...(scope ? { xTenantId: scope.tenantId } : {}),
        }),
      ),
  })
}

export function allFormFieldsQueryOptions(
  popupId: string | null,
  flowId?: string,
  scope?: FlowEditorScope,
) {
  return queryOptions({
    queryKey: ["form-fields", popupId, flowId, "all"] as const,
    queryFn: () =>
      scopedRead(scope, () =>
        FormFieldsService.listFormFields({
          popupId: popupId || undefined,
          salesFlowId: flowId,
          limit: 200,
          ...(scope ? { xTenantId: scope.tenantId } : {}),
        }),
      ),
  })
}

export function allFormSectionsQueryOptions(
  popupId: string | null,
  flowId?: string,
  scope?: FlowEditorScope,
) {
  return queryOptions({
    queryKey: ["form-sections", popupId, flowId, "all"] as const,
    queryFn: () =>
      scopedRead(scope, () =>
        FormSectionsService.listFormSections({
          popupId: popupId || undefined,
          salesFlowId: flowId,
          limit: 200,
          ...(scope ? { xTenantId: scope.tenantId } : {}),
        }),
      ),
  })
}

export const FLOW_SCOPE_STORAGE_KEY = "edgeos.flow-scope"

/** Shared fallback policy for navigation without an explicit flow. */
export function rememberedOrDefaultFlow(
  flows: SalesFlowPublic[],
  popupId?: string,
) {
  let rememberedId: string | undefined
  if (popupId && typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(FLOW_SCOPE_STORAGE_KEY)
      rememberedId = raw
        ? (JSON.parse(raw) as Record<string, string>)[popupId]
        : undefined
    } catch {
      // Storage failure only discards the remembered choice.
    }
  }
  return (
    flows.find((flow) => flow.id === rememberedId) ??
    flows.find((flow) => flow.is_default) ??
    flows[0]
  )
}
