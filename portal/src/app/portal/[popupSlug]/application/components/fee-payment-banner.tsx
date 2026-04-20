"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { ApplicationPublic } from "@/client"
import { ApplicationsService } from "@/client"
import { queryKeys } from "@/lib/query-keys"

const MAX_POLL_ATTEMPTS = 20

interface FeePaymentBannerProps {
  application: ApplicationPublic
  isReturnFromCheckout: boolean
}

export function FeePaymentBanner({
  application,
  isReturnFromCheckout,
}: FeePaymentBannerProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [isPolling, setIsPolling] = useState(isReturnFromCheckout)
  const [paymentConfirmed, setPaymentConfirmed] = useState(false)
  const pollAttemptsRef = useRef(0)

  const { data: polledApps } = useQuery({
    queryKey: [...queryKeys.applications.mine(), "fee-poll"],
    queryFn: async () => {
      const result = await ApplicationsService.listMyApplications()
      return result.results
    },
    refetchInterval: isPolling ? 3_000 : false,
    enabled: isPolling,
  })

  // React to poll results — stop polling when fee is resolved
  useEffect(() => {
    if (!isPolling || !polledApps) return

    pollAttemptsRef.current += 1

    const updated = polledApps.find((a) => a.id === application.id)
    if (updated && updated.status !== "pending_fee") {
      setIsPolling(false)
      setPaymentConfirmed(true)
      queryClient.invalidateQueries({ queryKey: queryKeys.applications.mine() })
      toast.success(t("application.fee.confirmation_toast"))
      return
    }

    if (pollAttemptsRef.current >= MAX_POLL_ATTEMPTS) {
      setIsPolling(false)
      toast.error(t("application.fee.confirmation_error"))
    }
  }, [polledApps, isPolling, application.id, queryClient, t])

  // Polling view — returning from checkout, waiting for confirmation
  if (isReturnFromCheckout && isPolling) {
    return (
      <div className="mx-8 md:mx-12 mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <h3 className="font-semibold text-amber-900">
              {t("application.fee.processing_title")}
            </h3>
            <p className="mt-1 text-sm text-amber-700">
              {t("application.fee.processing_description")}
            </p>
          </div>
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
        </div>
      </div>
    )
  }

  // Confirmed view — payment resolved after polling
  if (isReturnFromCheckout && paymentConfirmed) {
    return (
      <div className="mx-8 md:mx-12 mb-6 rounded-lg border border-green-200 bg-green-50 p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <h3 className="font-semibold text-green-900">
              {t("application.fee.confirmed_title")}
            </h3>
            <p className="mt-1 text-sm text-green-700">
              {t("application.fee.confirmed_description")}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return null
}
