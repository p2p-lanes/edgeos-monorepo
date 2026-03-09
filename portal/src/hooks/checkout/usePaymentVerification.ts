"use client"

import { useQuery } from "@tanstack/react-query"
import { useRef } from "react"
import type { PaymentStatus } from "@/client"
import { PaymentsService } from "@/client"

export type VerifiedPaymentStatus = "verifying" | PaymentStatus | "error"

interface UsePaymentVerificationParams {
  applicationId: string | undefined
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
  enabled,
}: UsePaymentVerificationParams): UsePaymentVerificationResult {
  const pollCountRef = useRef(0)

  const { data, isLoading, isError } = useQuery({
    queryKey: ["payment-verification", applicationId],
    queryFn: async () => {
      pollCountRef.current += 1
      const result = await PaymentsService.getMyLatestPayment({
        applicationId: applicationId!,
      })
      return result
    },
    enabled: enabled && !!applicationId,
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

  if (!enabled) {
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
