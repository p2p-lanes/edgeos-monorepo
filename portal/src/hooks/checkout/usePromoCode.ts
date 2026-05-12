import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import { CouponsService } from "@/client"
import type { CartState } from "@/hooks/useCartApi"
import type { DiscountProps } from "@/types/discounts"

interface UsePromoCodeParams {
  cityId: string | undefined
  discountAppliedValue: number
  setDiscount: (discount: DiscountProps) => void
  resetDiscount: () => void
  savedCart: CartState | null | undefined
  hasRestoredCheckoutRef: MutableRefObject<boolean>
  validatePromoCodeOverride?: (code: string) => Promise<number | null>
}

export function usePromoCode({
  cityId,
  discountAppliedValue,
  setDiscount,
  resetDiscount,
  savedCart,
  hasRestoredCheckoutRef,
  validatePromoCodeOverride,
}: UsePromoCodeParams) {
  const [promoCode, setPromoCode] = useState("")
  const [promoCodeValid, setPromoCodeValid] = useState(false)
  const [promoCodeDiscount, setPromoCodeDiscount] = useState(0)

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyPromoCode = useCallback(
    async (code: string): Promise<boolean> => {
      if (!cityId && !validatePromoCodeOverride) return false

      setIsLoading(true)
      setError(null)

      try {
        const rawResponse = validatePromoCodeOverride
          ? await validatePromoCodeOverride(code.toUpperCase())
          : await CouponsService.validateCoupon({
              requestBody: {
                popup_id: cityId!,
                code: code.toUpperCase(),
              },
            })
        console.log("[promo-debug] applyPromoCode API response", {
          code: code.toUpperCase(),
          rawResponse,
          cityId,
          discountAppliedValue,
        })
        const discountValue =
          typeof rawResponse === "number"
            ? (rawResponse ?? 0)
            : ((rawResponse as { discount_value?: number })?.discount_value ??
              0)

        // A 0% (or missing) discount is meaningless — surfacing it as a valid
        // applied code confuses users ("Code applied!" + unchanged total).
        if (discountValue <= 0) {
          console.warn("[promo-debug] applyPromoCode rejected: discount <= 0", {
            discountValue,
          })
          setError("Invalid promo code")
          return false
        }

        if (discountValue >= discountAppliedValue) {
          console.log("[promo-debug] applyPromoCode setting state", {
            discountValue,
            discountAppliedValue,
            willCallSetDiscount: true,
          })
          setPromoCode(code.toUpperCase())
          setPromoCodeValid(true)
          setPromoCodeDiscount(discountValue)

          setDiscount({
            discount_value: discountValue,
            discount_type: "percentage",
            discount_code: code.toUpperCase(),
            city_id: cityId ?? null,
          })

          return true
        }
        console.warn(
          "[promo-debug] applyPromoCode rejected: discountValue < discountAppliedValue",
          { discountValue, discountAppliedValue },
        )
        return false
      } catch (err) {
        console.error("[promo-debug] applyPromoCode threw", err)
        return false
      } finally {
        setIsLoading(false)
      }
    },
    [cityId, discountAppliedValue, setDiscount, validatePromoCodeOverride],
  )

  const clearPromoCode = useCallback(() => {
    setPromoCode("")
    setPromoCodeValid(false)
    setPromoCodeDiscount(0)
    resetDiscount()
  }, [resetDiscount])

  // Re-validate promo code from saved cart
  const hasRevalidatedPromoRef = useRef(false)
  useEffect(() => {
    if (hasRevalidatedPromoRef.current || !hasRestoredCheckoutRef.current)
      return
    // If the user already applied a promo this session, skip re-validation —
    // applyPromoCode is authoritative. Without this guard, a saved-cart write
    // triggered by applyPromoCode itself can race back here and clobber
    // promoCodeDiscount to 0 if the API response is missing discount_value.
    if (promoCodeValid) {
      hasRevalidatedPromoRef.current = true
      return
    }
    if (!savedCart?.promo_code || !cityId || validatePromoCodeOverride) return

    hasRevalidatedPromoRef.current = true

    CouponsService.validateCoupon({
      requestBody: {
        popup_id: String(cityId),
        code: savedCart.promo_code,
      },
    })
      .then((result) => {
        const discountValue = result.discount_value ?? 0
        if (discountValue <= 0) {
          toast.info("Your promo code is no longer valid")
          return
        }
        setPromoCode(savedCart.promo_code!)
        setPromoCodeValid(true)
        setPromoCodeDiscount(discountValue)
        setDiscount({
          discount_value: discountValue,
          discount_type: "percentage",
          discount_code: savedCart.promo_code!,
          city_id: cityId ? String(cityId) : null,
        })
      })
      .catch(() => {
        toast.info("Your promo code is no longer valid")
      })
  }, [
    savedCart,
    cityId,
    setDiscount,
    hasRestoredCheckoutRef.current,
    validatePromoCodeOverride,
    promoCodeValid,
  ])

  return {
    promoCode,
    promoCodeValid,
    promoCodeDiscount,
    setPromoCode,
    setPromoCodeValid,
    setPromoCodeDiscount,
    applyPromoCode,
    clearPromoCode,
    promoIsLoading: isLoading,
    promoError: error,
    setPromoError: setError,
  }
}
