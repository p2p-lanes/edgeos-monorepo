"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { PaymentsService } from "@/client"
import { markPurchasePending } from "@/hooks/usePaymentRedirect"
import { queryKeys } from "@/lib/query-keys"
import type { AttendeePassState } from "@/types/Attendee"
import type {
  CheckoutStep,
  SelectedHousingItem,
  SelectedMerchItem,
  SelectedPassItem,
  SelectedPatronItem,
} from "@/types/checkout"
import { buildPaymentProducts } from "./buildPaymentProducts"

interface UsePaymentSubmitParams {
  applicationId: string | undefined
  appCredit: string | number | null | undefined
  attendeePasses: AttendeePassState[]
  selectedPasses: SelectedPassItem[]
  housing: SelectedHousingItem | null
  merch: SelectedMerchItem[]
  patron: SelectedPatronItem | null
  promoCode: string
  promoCodeValid: boolean
  insurance: boolean
  isEditing: boolean
  toggleEditing: (editing?: boolean) => void
  clearCart: () => void
  setCurrentStep: (step: CheckoutStep) => void
  setPromoError: (error: string | null) => void
  paymentCompleteRef: React.MutableRefObject<boolean>
}

interface PaymentSubmitResult {
  success: boolean
  error?: string
}

export function usePaymentSubmit({
  applicationId,
  appCredit,
  attendeePasses,
  selectedPasses,
  housing,
  merch,
  patron,
  promoCode,
  promoCodeValid,
  insurance,
  isEditing,
  toggleEditing,
  clearCart,
  setCurrentStep,
  setPromoError,
  paymentCompleteRef,
}: UsePaymentSubmitParams) {
  const queryClient = useQueryClient()
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Reset isSubmitting when page is restored from bfcache
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setIsSubmitting(false)
      }
    }

    window.addEventListener("pageshow", handlePageShow)
    return () => window.removeEventListener("pageshow", handlePageShow)
  }, [])

  const submitPayment = useCallback(async (): Promise<PaymentSubmitResult> => {
    if (!applicationId) {
      return { success: false, error: "Application not available" }
    }

    if (selectedPasses.length === 0) {
      return {
        success: false,
        error: isEditing
          ? "Please select a new pass"
          : "Please select at least one pass",
      }
    }

    setIsSubmitting(true)
    setPromoError(null)

    try {
      const { products: productsToSend, isMonthUpgrade } = buildPaymentProducts(
        {
          attendeePasses,
          selectedPasses,
          housing,
          merch,
          patron,
          isEditing,
          appCredit,
        },
      )

      const result = await PaymentsService.createMyPayment({
        requestBody: {
          application_id: applicationId,
          products: productsToSend,
          coupon_code: promoCodeValid ? promoCode : undefined,
          edit_passes: isEditing || isMonthUpgrade ? true : undefined,
          insurance: insurance || undefined,
        },
      })

      const data = result as {
        status?: string
        checkout_url?: string | null
      }

      if (data.status === "pending" && data.checkout_url) {
        markPurchasePending()
        const currentUrl = new URL(window.location.href)
        currentUrl.searchParams.set("checkout", "success")
        const redirectUrl = currentUrl.toString()
        window.location.href = `${data.checkout_url}?redirect_url=${encodeURIComponent(redirectUrl)}`
        return { success: true }
      }

      if (data.status === "approved") {
        toast.success(
          isEditing
            ? "Your passes have been updated successfully!"
            : "Payment completed successfully!",
        )
        if (isEditing) {
          toggleEditing(false)
        }
        paymentCompleteRef.current = true
        clearCart()
        await queryClient.invalidateQueries({
          queryKey: queryKeys.applications.mine(),
        })
        await queryClient.invalidateQueries({
          queryKey: queryKeys.payments.all,
        })
        setCurrentStep("success")
        setIsSubmitting(false)
        return { success: true }
      }

      setIsSubmitting(false)
      return { success: true }
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to create payment"
      setPromoError(errorMsg)
      toast.error(errorMsg)
      setIsSubmitting(false)
      return { success: false, error: errorMsg }
    }
  }, [
    applicationId,
    appCredit,
    selectedPasses,
    merch,
    housing,
    patron,
    promoCodeValid,
    promoCode,
    insurance,
    clearCart,
    isEditing,
    attendeePasses,
    toggleEditing,
    queryClient,
    setCurrentStep,
    setPromoError,
    paymentCompleteRef,
  ])

  return { submitPayment, isSubmitting }
}
