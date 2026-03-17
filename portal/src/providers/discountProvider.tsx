"use client"

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

const DiscountContext = createContext<DiscountContextType | null>(null)

const DiscountProvider = ({ children }: { children: ReactNode }) => {
  const { getCity } = useCityProvider()
  const city = getCity()
  const { getRelevantApplication } = useApplication()
  const application = getRelevantApplication()
  const { data: groups = [] } = useGroupsQuery()

  const [discountApplied, setDiscountApplied] = useState<DiscountProps>({
    discount_value: 0,
    discount_type: "percentage",
    discount_code: null,
  })

  useEffect(() => {
    if (city?.id && discountApplied.city_id !== city?.id) {
      setDiscountApplied({ discount_value: 0, discount_type: "percentage" })
    }
  }, [city?.id, discountApplied.city_id])

  useEffect(() => {
    if (application?.group_id && groups.length > 0) {
      const group = groups.find((g) => g.id === application.group_id)
      const groupDiscount = Number(group?.discount_percentage ?? 0)
      if (
        group?.discount_percentage &&
        groupDiscount > discountApplied.discount_value
      ) {
        setDiscountApplied({
          discount_value: groupDiscount,
          discount_type: "percentage",
          discount_code: null,
        })
      }
    }
  }, [application?.group_id, groups, discountApplied.discount_value])

  const discountRef = useRef(discountApplied)
  discountRef.current = discountApplied

  const setDiscount = useCallback((discount: DiscountProps) => {
    if (discount.discount_value <= discountRef.current.discount_value) return
    setDiscountApplied(discount)
  }, [])

  const resetDiscount = useCallback(() => {
    setDiscountApplied({
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
