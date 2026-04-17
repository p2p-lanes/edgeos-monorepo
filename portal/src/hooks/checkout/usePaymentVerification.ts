"use client"

import { useQuery } from "@tanstack/react-query"
import { useRef } from "react"
import type { PaymentStatus } from "@/client"
import { PaymentsService } from "@/client"

export type VerifiedPaymentStatus = "verifying" | PaymentStatus | "error"

interface UsePaymentVerificationParams {
  applicationId?: string
  /**
   * Payment id used when there is no application (direct-sale flow).
   * When `applicationId` is absent and `paymentId` is present the hook
   * polls by payment id instead of by latest-for-application.
   */
  paymentId?: string
  enabled: boolean
}

interface UsePaymentVerificationResult {
  paymentStatus: VerifiedPaymentStatus
  isVerifying: boolean
}

const MAX_POLL_ATTEMPTS = 20
const POLL_INTERVAL_MS = 3_000

export function usePaymentVerification({
  applicationId,
  paymentId,
  enabled,
}: UsePaymentVerificationParams): UsePaymentVerificationResult {
  const pollCountRef = useRef(0)
  const identifierRef = useRef<string | null>(
    applicationId ?? paymentId ?? null,
  )

  const currentIdentifier = applicationId ?? paymentId ?? null
  if (identifierRef.current !== currentIdentifier) {
    identifierRef.current = currentIdentifier
    pollCountRef.current = 0
  }

  const useApplicationPath = enabled && !!applicationId
  const usePaymentIdPath = enabled && !applicationId && !!paymentId

  const { data, isLoading, isError } = useQuery({
    queryKey: [
      "payment-verification",
      applicationId ?? null,
      applicationId ? null : (paymentId ?? null),
    ],
    queryFn: async () => {
      pollCountRef.current += 1
      if (useApplicationPath) {
        return PaymentsService.getMyLatestPayment({
          applicationId: applicationId!,
        })
      }
      return PaymentsService.getMyPaymentStatus({
        paymentId: paymentId!,
      })
    },
    enabled: useApplicationPath || usePaymentIdPath,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      // Stop polling if status is resolved or max attempts reached
      if (status && status !== "pending") return false
      if (pollCountRef.current >= MAX_POLL_ATTEMPTS) return false
      return POLL_INTERVAL_MS
    },
    retry: 1,
    staleTime: 0,
    gcTime: 0,
  })

  // Hook is disabled, OR no identifier at all — treat as no-op / approved.
  if (!enabled || (!applicationId && !paymentId)) {
    return { paymentStatus: "approved", isVerifying: false }
  }

  if (isError) {
    return { paymentStatus: "error", isVerifying: false }
  }

  if (isLoading || !data) {
    return { paymentStatus: "verifying", isVerifying: true }
  }

  const status = data.status
  const isStillPolling =
    status === "pending" && pollCountRef.current < MAX_POLL_ATTEMPTS

  return {
    paymentStatus: status,
    isVerifying: isStillPolling,
  }
}
