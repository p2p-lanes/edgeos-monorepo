"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import type { CheckoutMode } from "@/checkout/popupCheckoutPolicy"
import { CheckoutService, PaymentsService } from "@/client"
import { getMetaAttribution, trackMetaPurchase } from "@/lib/meta-pixel"
import { queryKeys } from "@/lib/query-keys"
import type { AttendeePassState } from "@/types/Attendee"
import type {
  CheckoutStep,
  SelectedDynamicItem,
  SelectedHousingItem,
  SelectedMealPlanItem,
  SelectedMerchItem,
  SelectedPassItem,
  SelectedPatronItem,
} from "@/types/checkout"
import { buildPaymentProducts } from "./buildPaymentProducts"

interface UsePaymentSubmitParams {
  applicationId: string | undefined
  popupId: string | null
  popupSlug: string | null
  appCredit: string | number | null | undefined
  checkoutMode: CheckoutMode
  attendeePasses: AttendeePassState[]
  selectedPasses: SelectedPassItem[]
  housing: SelectedHousingItem | null
  merch: SelectedMerchItem[]
  patron: SelectedPatronItem | null
  selectedMealPlans: SelectedMealPlanItem[]
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
  submitMode: "application" | "open-ticketing"
  buyerData: {
    email: string
    firstName: string
    lastName: string
    formData: Record<string, unknown>
  } | null
  creditsEnabled: boolean
  popupName?: string | null
}

interface PaymentSubmitResult {
  success: boolean
  error?: string
}

export function usePaymentSubmit({
  applicationId,
  popupId,
  popupSlug,
  appCredit,
  checkoutMode,
  attendeePasses,
  selectedPasses,
  housing,
  merch,
  patron,
  selectedMealPlans,
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
  submitMode,
  buyerData,
  creditsEnabled,
  popupName,
}: UsePaymentSubmitParams) {
  const queryClient = useQueryClient()
  const router = useRouter()
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
    // Guard against double-submits that bypass the disabled-button state:
    // bfcache restore resets isSubmitting to false, and the post-success
    // reset can race the redirect. Without this, the same checkout can be
    // re-posted from the same browser session.
    if (isSubmitting || paymentCompleteRef.current) {
      return { success: false, error: "Payment already submitted" }
    }

    if (submitMode === "application" && !applicationId) {
      return { success: false, error: "Application not available" }
    }

    if (submitMode === "open-ticketing" && (!popupSlug || !buyerData)) {
      return { success: false, error: "Buyer information not available" }
    }

    // Mirror CartFooter.canContinue: any cart selection counts as "has something
    // to buy", not just selectedPasses. Tickets selected via DynamicProductStep
    // land in dynamicItems (not selectedPasses), so a passes-only guard would
    // block dynamic-tickets flows entirely.
    const hasDynamicItems = Object.values(dynamicItems).some((items) =>
      items.some((i) => i.quantity > 0),
    )
    const hasAnyCartSelection =
      selectedPasses.length > 0 ||
      !!housing ||
      merch.length > 0 ||
      !!patron ||
      selectedMealPlans.length > 0 ||
      hasDynamicItems

    if (!hasAnyCartSelection) {
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
          selectedMealPlans,
          dynamicItems,
          isEditing,
          appCredit,
          checkoutMode,
          creditsEnabled,
        },
      )

      const result =
        submitMode === "open-ticketing"
          ? await CheckoutService.purchaseOpenTicketing({
              slug: popupSlug!,
              requestBody: {
                ...getMetaAttribution(),
                products: Object.values(
                  productsToSend.reduce<
                    Record<string, { product_id: string; quantity: number }>
                  >((acc, product) => {
                    const quantity = product.quantity ?? 1
                    const existing = acc[product.product_id]
                    if (existing) {
                      existing.quantity += quantity
                    } else {
                      acc[product.product_id] = {
                        product_id: product.product_id,
                        quantity,
                      }
                    }
                    return acc
                  }, {}),
                ),
                buyer: {
                  email: buyerData!.email,
                  first_name: buyerData!.firstName,
                  last_name: buyerData!.lastName,
                  // form_data carries only custom field values; strip the form's "custom_" prefix to send raw field names.
                  form_data: Object.fromEntries(
                    Object.entries(buyerData!.formData).flatMap(
                      ([key, value]) =>
                        key.startsWith("custom_")
                          ? [[key.slice("custom_".length), value]]
                          : [],
                    ),
                  ),
                },
                coupon_code: promoCodeValid ? promoCode : undefined,
              },
            })
          : await PaymentsService.createMyPayment({
              requestBody: {
                application_id: applicationId,
                products: productsToSend,
                coupon_code: promoCodeValid ? promoCode : undefined,
                edit_passes: isEditing || isMonthUpgrade ? true : undefined,
                insurance: insurance || undefined,
              },
            })

      const data = result as {
        id?: string
        payment_id?: string
        status?: string
        checkout_url?: string | null
        amount?: string
        currency?: string
      }

      if (data.status === "pending" && data.checkout_url) {
        window.location.href = data.checkout_url
        return { success: true }
      }

      if (data.status === "approved") {
        const paymentId = data.id ?? data.payment_id
        if (
          submitMode === "open-ticketing" &&
          popupId &&
          popupSlug &&
          paymentId
        ) {
          trackMetaPurchase({
            paymentId,
            popup: {
              id: popupId,
              slug: popupSlug,
              name: popupName,
            },
            amount: data.amount ?? 0,
            currency: data.currency ?? "USD",
            products: productsToSend,
          })
        }
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
          // Defense-in-depth: the /passes view reads from the human-attendees
          // query too (via passesProvider), which embeds products per attendee.
          // Without this invalidation the page can render stale attendee data
          // even after purchases.byPopup refetches.
          popupId
            ? queryClient.invalidateQueries({
                queryKey: queryKeys.attendees.byHumanPopup(popupId),
              })
            : Promise.resolve(),
        ])
        if (popupSlug) {
          // Approved-on-create only happens when the cart was zero-amount and
          // SimpleFI was bypassed (paid flows return status=pending + a
          // checkout_url and never hit this branch). Edits are adjustments,
          // not ceremonies — keep those landing on /passes. For everything
          // else, the thank-you page provides closure and confirms that the
          // email was sent, matching the open-ticketing zero-amount path.
          if (isEditing) {
            router.replace(`/portal/${popupSlug}/passes`)
          } else {
            const qs = paymentId ? `?payment_id=${paymentId}` : ""
            router.replace(`/checkout/${popupSlug}/thank-you${qs}`)
          }
        } else {
          // Fallback when slug is unavailable: keep the legacy success step
          // so the success state is at least visible.
          setCurrentStep("success")
        }
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
    buyerData,
    appCredit,
    checkoutMode,
    selectedPasses,
    merch,
    housing,
    patron,
    selectedMealPlans,
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
    popupSlug,
    submitMode,
    popupName,
    router,
    creditsEnabled,
    isSubmitting,
  ])

  return { submitPayment, isSubmitting }
}
