import { useCallback, useState } from "react"
import type { SelectedMealPlanItem } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"

/**
 * State + actions for the meal-plan checkout step.
 *
 * One entry per (attendee, weekly product). The reducer mirrors
 * `cart-state.prototype.ts`:
 *   - `addMealPlan` seeds `dailyChoices` to {date: "chef"} for every weekday
 *     in the coverage range; the buyer overrides per day from the editor.
 *   - `removeMealPlan` drops the entry.
 *   - `setMealPlanDailyChoice` updates a single date's pick.
 *   - `setMealPlanDietaryRestriction` / `setMealPlanSpecialRequest` apply at
 *     the attendee level — synced across every meal-plan entry for that attendee.
 *
 * `addMealPlan` accepts the resolved weekday dates from the variant (which
 * derives them from the step's `template_config.sections[].products[]`
 * coverage range). The hook stays templateConfig-agnostic.
 */
export function useMealPlanSelection(allActiveProducts: ProductsPass[]) {
  const [mealPlans, setMealPlans] = useState<SelectedMealPlanItem[]>([])

  const addMealPlan = useCallback(
    (attendeeId: string, productId: string, weekdayDates: string[]) => {
      const product = allActiveProducts.find((p) => p.id === productId)
      if (!product) return
      setMealPlans((prev) => {
        // Idempotent — if (attendee, product) already exists, no-op.
        if (
          prev.some(
            (m) => m.attendeeId === attendeeId && m.productId === productId,
          )
        ) {
          return prev
        }
        // Inherit per-attendee dietary + special request from any sibling
        // entry so previously typed values stick when adding another week.
        const sibling = prev.find((m) => m.attendeeId === attendeeId)
        const dailyChoices = Object.fromEntries(
          weekdayDates.map((d) => [d, "chef"]),
        )
        return [
          ...prev,
          {
            productId,
            product,
            attendeeId,
            dailyChoices,
            dietaryRestriction: sibling?.dietaryRestriction ?? null,
            specialRequest: sibling?.specialRequest ?? null,
          },
        ]
      })
    },
    [allActiveProducts],
  )

  const removeMealPlan = useCallback(
    (attendeeId: string, productId: string) => {
      setMealPlans((prev) =>
        prev.filter(
          (m) => !(m.attendeeId === attendeeId && m.productId === productId),
        ),
      )
    },
    [],
  )

  const setMealPlanDailyChoice = useCallback(
    (attendeeId: string, productId: string, date: string, menuKey: string) => {
      setMealPlans((prev) =>
        prev.map((m) =>
          m.attendeeId === attendeeId && m.productId === productId
            ? {
                ...m,
                dailyChoices: {
                  ...(m.dailyChoices ?? {}),
                  [date]: menuKey,
                },
              }
            : m,
        ),
      )
    },
    [],
  )

  const setMealPlanDietaryRestriction = useCallback(
    (attendeeId: string, value: string) => {
      const normalized = value || null
      setMealPlans((prev) =>
        prev.map((m) =>
          m.attendeeId === attendeeId
            ? { ...m, dietaryRestriction: normalized }
            : m,
        ),
      )
    },
    [],
  )

  const setMealPlanSpecialRequest = useCallback(
    (attendeeId: string, value: string) => {
      const normalized = value || null
      setMealPlans((prev) =>
        prev.map((m) =>
          m.attendeeId === attendeeId
            ? { ...m, specialRequest: normalized }
            : m,
        ),
      )
    },
    [],
  )

  return {
    mealPlans,
    setMealPlans,
    addMealPlan,
    removeMealPlan,
    setMealPlanDailyChoice,
    setMealPlanDietaryRestriction,
    setMealPlanSpecialRequest,
  }
}
