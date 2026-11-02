import type { CartState } from "@/hooks/useCartApi"

export interface CartSummary {
  passes: number
  merch: number
  /** Product and meal plan lines from steps with no label of their own. */
  otherItems: number
  hasHousing: boolean
  hasPatron: boolean
  itemCount: number
}

export function summarizeCart(cart: CartState): CartSummary {
  const summary: CartSummary = {
    passes: 0,
    merch: 0,
    otherItems: 0,
    hasHousing: false,
    hasPatron: false,
    itemCount: 0,
  }

  for (const line of cart.lines) {
    switch (line.kind) {
      case "product":
        summary.itemCount += line.quantity
        if (line.step_type === "tickets") summary.passes += line.quantity
        else if (line.step_type === "merch") summary.merch += line.quantity
        else summary.otherItems += line.quantity
        break
      case "date_range":
      case "accommodation":
        summary.itemCount += 1
        summary.hasHousing = true
        break
      case "custom_amount":
        summary.itemCount += 1
        summary.hasPatron = true
        break
      case "meal_plan":
        summary.itemCount += 1
        summary.otherItems += 1
        break
    }
  }

  return summary
}
