"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { PaymentsService } from "@/client"
import { markPurchasePending } from "@/hooks/usePaymentRedirect"
import { queryKeys } from "@/lib/query-keys"
import type { AttendeePassState } from "@/types/Attendee"
import type {
  CheckoutStep,
  SelectedDynamicItem,
  SelectedHousingItem,
  SelectedMerchItem,
  SelectedPassItem,
  SelectedPatronItem,
} from "@/types/checkout"
import { buildPaymentProducts } from "./buildPaymentProducts"

interface UsePaymentSubmitParams {
  applicationId: string | undefined
  popupId: string | null
  appCredit: string | number | null | undefined
  attendeePasses: AttendeePassState[]
  selectedPasses: SelectedPassItem[]
  housing: SelectedHousingItem | null
  merch: SelectedMerchItem[]
  patron: SelectedPatronItem | null
  dynamicItems: Record<string, SelectedDynamicItem[]>
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
  popupId,
  appCredit,
  attendeePasses,
  selectedPasses,
  housing,
  merch,
  patron,
  dynamicItems,
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
  // Holds the id of the last payment created by this hook. Used by payment
  // verification polling after a SimpleFI redirect (direct-sale flow has no
  // application_id, so verification keys off payment_id instead).
  const lastPaymentIdRef = useRef<string | null>(null)

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
    // Direct-sale flow: no application_id, but we do have a popup_id. We POST
    // to /payments/direct with a minimal product list (no housing/merch/etc.
    // in Feature 1 scope — those extras come with checkout_mode work).
    const isDirectSale = !applicationId && !!popupId

    if (!isDirectSale && !applicationId) {
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
          dynamicItems,
          isEditing,
          appCredit,
        },
      )

      const result = isDirectSale
        ? await PaymentsService.createDirectPayment({
            requestBody: {
              popup_id: popupId!,
              products: productsToSend.map((p) => ({
                product_id: p.product_id,
                quantity: p.quantity,
              })),
            },
          })
        : await PaymentsService.createMyPayment({
            requestBody: {
              application_id: applicationId!,
              products: productsToSend,
              coupon_code: promoCodeValid ? promoCode : undefined,
              edit_passes: isEditing || isMonthUpgrade ? true : undefined,
              insurance: insurance || undefined,
            },
          })

      const data = result as {
        id?: string
        status?: string
        checkout_url?: string | null
      }

      if (data.id) {
        lastPaymentIdRef.current = data.id
      }

      if (data.status === "pending" && data.checkout_url) {
        markPurchasePending()
        window.location.href = data.checkout_url
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
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: queryKeys.applications.mine(),
          }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.payments.all,
          }),
          popupId
            ? queryClient.invalidateQueries({
                queryKey: queryKeys.purchases.byPopup(popupId),
              })
            : Promise.resolve(),
        ])
        setCurrentStep("success")
        setIsSubmitting(false)
        return { success: true }
      }

      setIsSubmitting(false)
      return { success: true }
    } catch (err: unknown) {
      console.error("Payment failed:", err)
      const errorMsg =
        "Something went wrong with your payment. Please try again."
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
    dynamicItems,
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
    popupId,
  ])

  return { submitPayment, isSubmitting, lastPaymentIdRef }
}
