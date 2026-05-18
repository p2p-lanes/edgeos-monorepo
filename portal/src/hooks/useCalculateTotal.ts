"use client"

import { useMemo } from "react"
import { resolvePopupCheckoutPolicy } from "@/checkout/popupCheckoutPolicy"
import { useGroupsQuery } from "@/components/Sidebar/hooks/useGetGroups"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { useDiscount } from "@/providers/discountProvider"
import { usePassesProvider } from "@/providers/passesProvider"
import { TotalCalculator } from "@/strategies/TotalStrategy"

export function useCalculateTotal() {
  const { getRelevantApplication } = useApplication()
  const application = getRelevantApplication()
  const { getCity } = useCityProvider()
  const city = getCity()
  const { attendeePasses } = usePassesProvider()
  const { discountApplied } = useDiscount()
  const { data: groups = [] } = useGroupsQuery()
  const checkoutPolicy = resolvePopupCheckoutPolicy(city)
  const creditsEnabled = city?.credits_enabled ?? false

  return useMemo(() => {
    let groupDiscountValue = 0
    let groupNameValue: string | null = null

    if (application?.group_id && groups.length > 0) {
      const group = groups.find((g) => g.id === application.group_id)
      if (group?.discount_percentage) {
        groupDiscountValue = Number(group.discount_percentage)
        groupNameValue = group.name
      }
    }

    let scholarshipDiscountValue = 0
    if (
      application?.scholarship_status === "approved" &&
      application.discount_percentage != null
    ) {
      const parsed = Number(application.discount_percentage)
      if (!Number.isNaN(parsed) && parsed > 0) {
        scholarshipDiscountValue = parsed
      }
    }

    const calculator = new TotalCalculator(
      checkoutPolicy.checkoutMode,
      creditsEnabled,
    )
    const result = calculator.calculate(
      attendeePasses,
      discountApplied,
      groupDiscountValue,
      scholarshipDiscountValue,
    )
    const balance = result.total

    return {
      total: balance,
      originalTotal: result.originalTotal,
      discountAmount: result.discountAmount,
      balance,
      appliedDiscount: result.appliedDiscount,
      groupDiscountPercentage: groupDiscountValue,
      groupName: groupNameValue,
      scholarshipDiscountPercentage: scholarshipDiscountValue,
    }
  }, [
    application,
    attendeePasses,
    checkoutPolicy.checkoutMode,
    creditsEnabled,
    discountApplied,
    groups,
  ])
}
