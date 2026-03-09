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
}

export function usePromoCode({
  cityId,
  discountAppliedValue,
  setDiscount,
  resetDiscount,
  savedCart,
  hasRestoredCheckoutRef,
}: UsePromoCodeParams) {
  const [promoCode, setPromoCode] = useState("")
  const [promoCodeValid, setPromoCodeValid] = useState(false)
  const [promoCodeDiscount, setPromoCodeDiscount] = useState(0)

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyPromoCode = useCallback(
    async (code: string): Promise<boolean> => {
      if (!cityId) return false

      setIsLoading(true)
      setError(null)

      try {
        const result = await CouponsService.validateCoupon({
          requestBody: {
            popup_id: cityId!,
            code: code.toUpperCase(),
          },
        })

        const discountValue = result.discount_value ?? 0

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
    [cityId, discountAppliedValue, setDiscount],
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
  }, [savedCart, cityId, setDiscount, hasRestoredCheckoutRef.current])

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
