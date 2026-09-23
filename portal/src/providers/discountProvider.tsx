"use client"

import { useSearchParams } from "next/navigation"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useGroupsQuery } from "@/components/Sidebar/hooks/useGetGroups"
import type { DiscountProps } from "@/types/discounts"
import { useApplication } from "./applicationProvider"
import { useCityProvider } from "./cityProvider"

interface DiscountContextType {
  discountApplied: DiscountProps
  setDiscount: (discount: DiscountProps) => void
  resetDiscount: () => void
}

export const DiscountContext = createContext<DiscountContextType | null>(null)

const DiscountProvider = ({ children }: { children: ReactNode }) => {
  const { getCity } = useCityProvider()
  const city = getCity()
  const { getRelevantApplication } = useApplication()
  // This provider wraps the checkout rather than living inside it, so
  // there is no `useCheckout` to ask — the portal carries the door in
  // `?flow=`. A group discount belongs to the application that joined
  // that group, and reading another door's used to apply the wrong one
  // (sdd/sales-flows-rediseno).
  const flowId = useSearchParams().get("flow")
  const application = getRelevantApplication(flowId)
  const { data: groups = [] } = useGroupsQuery()

  // Only manually entered discounts (coupons) belong in state. Group and
  // scholarship awards are derived from the current flow's application: they
  // must disappear immediately when its award changes or the flow changes.
  const [manualDiscount, setManualDiscount] = useState<DiscountProps>({
    discount_value: 0,
    discount_type: "percentage",
    discount_code: null,
  })

  useEffect(() => {
    if (city?.id && manualDiscount.city_id !== city.id) {
      setManualDiscount({
        discount_value: 0,
        discount_type: "percentage",
        discount_code: null,
        city_id: city.id,
      })
    }
  }, [city?.id, manualDiscount.city_id])

  const group = groups.find((g) => g.id === application?.group_id)
  const groupDiscount = Number(group?.discount_percentage ?? 0)
  const scholarshipDiscount =
    application?.scholarship_status === "approved"
      ? Number(application.discount_percentage ?? 0)
      : 0
  // The backend chooses the lowest final amount among percentage discounts,
  // rather than stacking them. On the same discountable subtotal (and credit),
  // that is the largest percentage. Scholarship wins ties, like payment/crud.py.
  const automaticDiscount = Math.max(groupDiscount, scholarshipDiscount)
  const discountApplied: DiscountProps =
    automaticDiscount >= manualDiscount.discount_value && automaticDiscount > 0
      ? {
          discount_value: automaticDiscount,
          discount_type: "percentage",
          discount_code: null,
          city_id: city?.id,
        }
      : manualDiscount

  const discountRef = useRef(discountApplied)
  discountRef.current = discountApplied

  const setDiscount = useCallback((discount: DiscountProps) => {
    // Use `<` (not `<=`) so a coupon matching the current discount can still
    // overwrite metadata like discount_code / city_id, which the backend
    // needs to record the conversion even when the percentage is unchanged.
    if (discount.discount_value < discountRef.current.discount_value) return
    setManualDiscount(discount)
  }, [])

  const resetDiscount = useCallback(() => {
    setManualDiscount({
      discount_value: 0,
      discount_type: "percentage",
      discount_code: null,
    })
  }, [])

  const contextValue = useMemo(
    () => ({ discountApplied, setDiscount, resetDiscount }),
    [discountApplied, setDiscount, resetDiscount],
  )

  return (
    <DiscountContext.Provider value={contextValue}>
      {children}
    </DiscountContext.Provider>
  )
}

export const useDiscount = (): DiscountContextType => {
  const context = useContext(DiscountContext)
  if (!context) {
    throw new Error("useDiscount must be used within a DiscountProvider")
  }
  return context
}

export default DiscountProvider
