"use client"

import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { PaymentsService } from "@/client"

interface FeeResult {
  outcome: "created" | "already_pending"
  checkoutUrl: string
}

interface UseApplicationFeeResult {
  createOrResume: (applicationId: string) => Promise<FeeResult>
  isPending: boolean
  error: Error | null
  lastResult: FeeResult | null
}

export function useApplicationFee(): UseApplicationFeeResult {
  const [lastResult, setLastResult] = useState<FeeResult | null>(null)

  const mutation = useMutation({
    mutationFn: async (applicationId: string): Promise<FeeResult> => {
      try {
        const result = await PaymentsService.createMyApplicationFee({
          requestBody: { application_id: applicationId },
        })
        const checkoutUrl = result.checkout_url ?? ""
        return { outcome: "created", checkoutUrl }
      } catch (err: unknown) {
        // Check if it's a 409 (already-pending checkout)
        const anyErr = err as Record<string, unknown>
        const status =
          (anyErr?.status as number | undefined) ??
          (anyErr?.statusCode as number | undefined)

        if (status === 409) {
          // Backend returns: "A pending fee payment already exists. Checkout URL: {url}"
          const detail =
            (anyErr?.body as Record<string, unknown>)?.detail ??
            anyErr?.message ??
            ""
          const detailStr = String(detail)
          const marker = "Checkout URL: "
          const idx = detailStr.indexOf(marker)
          const checkoutUrl =
            idx !== -1 ? detailStr.slice(idx + marker.length).trim() : ""
          return { outcome: "already_pending", checkoutUrl }
        }

        // Any other error: re-throw so React Query treats it as error
        throw err
      }
    },
    onSuccess: (data) => {
      setLastResult(data)
    },
  })

  return {
    createOrResume: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    lastResult,
  }
}
