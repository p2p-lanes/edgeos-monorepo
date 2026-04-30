import { useQuery } from "@tanstack/react-query"
import type { PaymentPublic } from "@/client"
import { PaymentsService } from "@/client"
import { queryKeys } from "@/lib/query-keys"

export interface HumanPaymentsQueryOptions {
  offset?: number
  limit?: number
}

/**
 * Fetches all payments owned by the current Human for a given popup.
 *
 * Calls `GET /payments/my/popup/{popup_id}` which combines both
 * application-linked and direct-sale payments via the dual-path predicate.
 *
 * The query is disabled when `popupId` is null/undefined.
 */
export function useHumanPaymentsQuery(
  popupId: string | null | undefined,
  options?: HumanPaymentsQueryOptions,
) {
  const { offset = 0, limit = 50 } = options ?? {}

  return useQuery({
    queryKey: queryKeys.payments.byPopup(popupId ?? ""),
    queryFn: async (): Promise<PaymentPublic[]> => {
      const result = await PaymentsService.listMyPaymentsByPopup({
        popupId: popupId!,
        skip: offset,
        limit,
      })
      return result.results
    },
    enabled: popupId != null && popupId !== "",
  })
}

export default useHumanPaymentsQuery
