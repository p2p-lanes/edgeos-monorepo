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
  /** When true, allows re-validation of a restored promo code to proceed.
   *  Used to gate open-cart promo re-validation until the release-on-mount
   *  call settles so the coupon field never flashes "Invalid" before the
   *  pending hold is freed. Defaults to true (no gate) for non-open-cart flows. */
  releaseSettled?: boolean
}

export function usePromoCode({
  cityId,
  discountAppliedValue,
  setDiscount,
  resetDiscount,
  savedCart,
  hasRestoredCheckoutRef,
  validatePromoCodeOverride,
  releaseSettled = true,
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
        const discountValue =
          typeof rawResponse === "number"
            ? (rawResponse ?? 0)
            : ((rawResponse as { discount_value?: number })?.discount_value ??
              0)

        // A 0% (or missing) discount is meaningless — surfacing it as a valid
        // applied code confuses users ("Code applied!" + unchanged total).
        if (discountValue <= 0) {
          setError("Invalid promo code")
          return false
        }

        if (discountValue >= discountAppliedValue) {
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
        return false
      } catch {
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

  // Re-validate promo code from saved cart.
  // Gated on releaseSettled to prevent a "Invalid promo code" flash when the
  // backend coupon hold is not yet freed (the circularity fix).
  const hasRevalidatedPromoRef = useRef(false)
  useEffect(() => {
    if (hasRevalidatedPromoRef.current || !hasRestoredCheckoutRef.current)
      return
    // Gate: wait for the pending-release call to settle before re-validating.
    // releaseSettled defaults to true for non-open-cart flows (no gate needed).
    if (!releaseSettled) return
    // If the user already applied a promo this session, skip re-validation —
    // applyPromoCode is authoritative. Without this guard, a saved-cart write
    // triggered by applyPromoCode itself can race back here and clobber
    // promoCodeDiscount to 0 if the API response is missing discount_value.
    if (promoCodeValid) {
      hasRevalidatedPromoRef.current = true
      return
    }

    // Open-cart path: savedCart is null (cartPersistenceEnabled=false) but
    // hydrateFromSnapshot has already called setPromoCode with the restored code.
    // Re-validate via the override (uses public slug-based endpoint, no cityId needed).
    if (validatePromoCodeOverride && promoCode) {
      hasRevalidatedPromoRef.current = true
      validatePromoCodeOverride(promoCode)
        .then((discountValue) => {
          const value = discountValue ?? 0
          if (value <= 0) {
            // Clear silently — no "invalid" flash; the code may just be expired.
            setPromoCode("")
            return
          }
          setPromoCodeValid(true)
          setPromoCodeDiscount(value)
          setDiscount({
            discount_value: value,
            discount_type: "percentage",
            discount_code: promoCode,
            city_id: cityId ? String(cityId) : null,
          })
        })
        .catch(() => {
          // On error, clear silently — the create-time apply is authoritative.
          setPromoCode("")
        })
      return
    }

    // Portal/application path: savedCart is populated via useCartPersistence.
    if (!savedCart?.promo_code || !cityId) return

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
    promoCode,
    setDiscount,
    hasRestoredCheckoutRef.current,
    validatePromoCodeOverride,
    promoCodeValid,
    releaseSettled,
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
