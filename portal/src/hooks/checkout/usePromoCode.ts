import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { CouponsService } from "@/client"
import type { CartState } from "@/hooks/useCartApi"
import type { DiscountProps } from "@/types/discounts"

interface UsePromoCodeParams {
  cityId: string | undefined
  salesFlowId?: string | null
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
  salesFlowId = null,
  discountAppliedValue,
  setDiscount,
  resetDiscount,
  savedCart,
  hasRestoredCheckoutRef,
  validatePromoCodeOverride,
  releaseSettled = true,
}: UsePromoCodeParams) {
  const { t } = useTranslation()
  const [promoCode, setPromoCode] = useState("")
  const [promoCodeValid, setPromoCodeValid] = useState(false)
  const [promoCodeDiscount, setPromoCodeDiscount] = useState(0)

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const promoScope = `${cityId ?? ""}:${salesFlowId ?? ""}`
  const activePromoScopeRef = useRef(promoScope)
  activePromoScopeRef.current = promoScope

  const applyPromoCode = useCallback(
    async (code: string): Promise<boolean> => {
      if (!cityId && !validatePromoCodeOverride) return false
      const validationScope = promoScope

      setIsLoading(true)
      setError(null)

      try {
        const rawResponse = validatePromoCodeOverride
          ? await validatePromoCodeOverride(code.toUpperCase())
          : await CouponsService.validateCoupon({
              requestBody: {
                popup_id: cityId!,
                sales_flow_id: salesFlowId ?? undefined,
                code: code.toUpperCase(),
              },
            })
        const discountValue =
          typeof rawResponse === "number"
            ? (rawResponse ?? 0)
            : ((rawResponse as { discount_value?: number })?.discount_value ??
              0)

        if (activePromoScopeRef.current !== validationScope) return false

        // A 0% (or missing) discount is meaningless — surfacing it as a valid
        // applied code confuses users ("Code applied!" + unchanged total).
        if (discountValue <= 0) {
          setError(t("checkout.errors.confirm_coupon_invalid"))
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
        if (activePromoScopeRef.current === validationScope) {
          setIsLoading(false)
        }
      }
    },
    [
      cityId,
      discountAppliedValue,
      setDiscount,
      validatePromoCodeOverride,
      salesFlowId,
      t,
      promoScope,
    ],
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
  const previousPromoScopeRef = useRef(promoScope)
  const promoScopeChanged = previousPromoScopeRef.current !== promoScope
  useEffect(() => {
    if (!promoScopeChanged) return
    previousPromoScopeRef.current = promoScope
    hasRevalidatedPromoRef.current = false
    setPromoCode("")
    setPromoCodeValid(false)
    setPromoCodeDiscount(0)
    setIsLoading(false)
    setError(null)
    resetDiscount()
  }, [promoScope, promoScopeChanged, resetDiscount])
  useEffect(() => {
    // The scope-reset effect runs first. Re-validation starts on the following
    // render so an old flow's promo code can never be validated for the new one.
    if (promoScopeChanged) return
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
      const validationScope = promoScope
      hasRevalidatedPromoRef.current = true
      // Note: hasRevalidatedPromoRef is set before the async call so that a
      // concurrent savedCart write cannot trigger a second re-validation attempt.
      // Single-shot semantics are intentional: if the network call fails, the
      // promo field is cleared and the user can re-enter the code manually.
      // A retry loop would risk double-applying a single-use coupon hold.
      validatePromoCodeOverride(promoCode)
        .then((discountValue) => {
          if (activePromoScopeRef.current !== validationScope) return
          const value = discountValue ?? 0
          if (value <= 0) {
            // P3 fix: clear silently AND reset all promo state so the UI
            // never shows a visible code without a discount applied to it.
            setPromoCode("")
            setPromoCodeValid(false)
            setPromoCodeDiscount(0)
            resetDiscount()
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
          if (activePromoScopeRef.current !== validationScope) return
          // P3 fix: on transport error, clear all promo state (same as expired
          // path) so the UI stays consistent — no dangling visible code without
          // a discount applied to it. hasRevalidatedPromoRef stays true:
          // single-shot semantics prevent a retry loop from double-applying a
          // single-use coupon hold if the network recovers.
          setPromoCode("")
          setPromoCodeValid(false)
          setPromoCodeDiscount(0)
          resetDiscount()
        })
      return
    }

    // Portal/application path: savedCart is populated via useCartPersistence.
    if (!savedCart?.promo_code || !cityId) return

    hasRevalidatedPromoRef.current = true
    const validationScope = promoScope

    CouponsService.validateCoupon({
      requestBody: {
        popup_id: String(cityId),
        sales_flow_id: salesFlowId ?? undefined,
        code: savedCart.promo_code,
      },
    })
      .then((result) => {
        if (activePromoScopeRef.current !== validationScope) return
        const discountValue = result.discount_value ?? 0
        if (discountValue <= 0) {
          toast.info(t("checkout.cart.promo_code_expired"))
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
        if (activePromoScopeRef.current !== validationScope) return
        toast.info(t("checkout.cart.promo_code_expired"))
      })
  }, [
    savedCart,
    cityId,
    salesFlowId,
    promoCode,
    setDiscount,
    hasRestoredCheckoutRef.current,
    validatePromoCodeOverride,
    promoCodeValid,
    releaseSettled,
    resetDiscount,
    promoScopeChanged,
    promoScope,
    t,
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
