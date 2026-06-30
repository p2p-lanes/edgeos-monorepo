import { useMemo } from "react"
import type { AttendeePassState } from "@/types/Attendee"

interface UseCreditCalculationParams {
  attendeePasses: AttendeePassState[]
  isEditing: boolean
  editPassesEnabled: boolean
}

export function useCreditCalculation({
  attendeePasses,
  isEditing,
  editPassesEnabled,
}: UseCreditCalculationParams) {
  const editCredit = useMemo(() => {
    if (!editPassesEnabled) return 0
    if (!isEditing) return 0
    return attendeePasses.reduce((total, attendee) => {
      return (
        total +
        attendee.products
          .filter((p) => p.edit && p.purchased)
          .reduce((sum, p) => sum + p.price * (p.quantity ?? 1), 0)
      )
    }, 0)
  }, [attendeePasses, isEditing, editPassesEnabled])

  const monthUpgradeCredit = useMemo(() => {
    if (!editPassesEnabled) return 0
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

      // Only week/day purchases convert into credit toward the month/full
      // upgrade. The old behavior summed every non-patreon purchased product,
      // which inflated credit by including unrelated purchases (e.g. a
      // previously bought month from a different attendee group).
      const purchasedCredit = attendee.products
        .filter(
          (p) =>
            p.purchased &&
            p.category !== "patreon" &&
            (p.duration_type === "week" || p.duration_type === "day"),
        )
        .reduce(
          (sum, p) => sum + (p.original_price ?? p.price) * (p.quantity ?? 1),
          0,
        )

      return total + purchasedCredit
    }, 0)
  }, [attendeePasses, isEditing, editPassesEnabled])

  return { editCredit, monthUpgradeCredit }
}
