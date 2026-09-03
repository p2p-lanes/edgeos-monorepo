import { useQuery } from "@tanstack/react-query"
import { FormFieldsService } from "@/client"
import { queryKeys } from "@/lib/query-keys"
import type { ApplicationFormSchema } from "@/types/form-schema"

export function useApplicationSchema(
  popupId: string | undefined,
  /**
   * Explicit target sales flow chosen via the FlowPicker (sdd/sales-flows
   * D6 URL scheme, task 9.4). Omitted keeps the backend's default-flow
   * resolution.
   */
  salesFlowId?: string | null,
) {
  return useQuery({
    queryKey: queryKeys.formSchema.portal(popupId ?? "", salesFlowId),
    queryFn: async () => {
      const result = await FormFieldsService.getPortalApplicationSchema(
        salesFlowId
          ? { popupId: popupId!, salesFlowId }
          : { popupId: popupId! },
      )
      return result as unknown as ApplicationFormSchema
    },
    enabled: !!popupId,
    staleTime: 5 * 60 * 1000,
  })
}
