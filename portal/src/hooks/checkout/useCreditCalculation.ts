import { useMemo } from "react"
import type { AttendeePassState } from "@/types/Attendee"

interface UseCreditCalculationParams {
  attendeePasses: AttendeePassState[]
  isEditing: boolean
}

export function useCreditCalculation({
  attendeePasses,
  isEditing,
}: UseCreditCalculationParams) {
  const editCredit = useMemo(() => {
    if (!isEditing) return 0
    return attendeePasses.reduce((total, attendee) => {
      return (
        total +
        attendee.products
          .filter((p) => p.edit && p.purchased)
          .reduce((sum, p) => sum + p.price * (p.quantity ?? 1), 0)
      )
    }, 0)
  }, [attendeePasses, isEditing])

  const monthUpgradeCredit = useMemo(() => {
    if (isEditing) return 0

    const hasPatreonSelected = attendeePasses.some((a) =>
      a.products.some((p) => p.category === "patreon" && p.selected),
    )
    if (hasPatreonSelected) return 0

    return attendeePasses.reduce((total, attendee) => {
      const hasFullOrMonthSelected = attendee.products.some(
        (p) =>
          (p.duration_type === "full" || p.duration_type === "month") &&
          p.selected &&
          !p.purchased,
      )
      if (!hasFullOrMonthSelected) return total

      const hasPurchasedWeekOrDay = attendee.products.some(
        (p) =>
          (p.duration_type === "week" || p.duration_type === "day") &&
          p.purchased,
      )
      if (!hasPurchasedWeekOrDay) return total

      const purchasedCredit = attendee.products
        .filter((p) => p.category !== "patreon" && p.purchased)
        .reduce((sum, p) => sum + p.price * (p.quantity ?? 1), 0)

      return total + purchasedCredit
    }, 0)
  }, [attendeePasses, isEditing])

  return { editCredit, monthUpgradeCredit }
}
