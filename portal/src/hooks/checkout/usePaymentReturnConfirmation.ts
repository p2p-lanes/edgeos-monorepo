"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { PaymentsService } from "@/client"
import { queryKeys } from "@/lib/query-keys"
import { useTenant } from "@/providers/tenantProvider"

const PAYMENT_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

/** The server verifies ownership and provider status; URL order data is cosmetic. */
export function usePaymentReturnConfirmation(
  paymentId: string | null,
  popupSlug: string,
) {
  const { tenant } = useTenant()
  const queryClient = useQueryClient()
  const validId = Boolean(paymentId && PAYMENT_ID.test(paymentId))
  const query = useQuery({
    queryKey: ["payment-return-confirmation", tenant?.id, paymentId],
    queryFn: () => PaymentsService.confirmMyPayment({ paymentId: paymentId! }),
    enabled: validId,
    retry: false,
    refetchOnWindowFocus: false,
    // Bounded, sequential checks cover a provider still settling on return.
    refetchInterval: (current) =>
      current.state.data?.status === "pending" &&
      current.state.dataUpdateCount < 3
        ? 2000
        : false,
  })
  const approved = query.data?.status === "approved"
  useEffect(() => {
    if (!approved) return
    for (const queryKey of [
      queryKeys.applications.mine(),
      queryKeys.payments.all,
      queryKeys.checkout.runtime(popupSlug),
      ["attendees"],
      ["purchases"],
      ["participation"],
    ]) {
      queryClient.invalidateQueries({ queryKey })
    }
  }, [approved, popupSlug, queryClient])

  const state = approved
    ? "approved"
    : !validId || query.isError
      ? "unverified"
      : query.isPending
        ? "checking"
        : query.data?.status === "pending"
          ? "pending"
          : "unverified"
  return {
    state,
    retry: () => {
      if (validId) return query.refetch()
    },
    isFetching: query.isFetching,
  } as const
}
