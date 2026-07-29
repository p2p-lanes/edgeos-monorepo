// Pure step-derivation logic ported 1:1 from the portal hooks
// `useStepProductResolver.ts` and `useCheckoutSteps.ts`. No React, no state —
// deterministic functions the store (Task 2.10) and the React adapter (Plan 3)
// both build on. Behavior parity with the portal is the bar.

import type { CheckoutRuntimeProduct, TicketingStep } from "../types/api"
import type { CheckoutStep } from "../types/checkout"
import { CONTENT_ONLY_TEMPLATES } from "./templates"

/**
 * Map an API `step_type` to an internal {@link CheckoutStep}. "tickets" →
 * "passes" for parity with the existing components; unknown types pass through.
 */
export function toCheckoutStep(stepType: string): CheckoutStep | null {
  switch (stepType) {
    case "tickets":
      return "passes"
    case "buyer":
      return "buyer"
    case "housing":
      return "housing"
    case "merch":
      return "merch"
    case "patron":
      return "patron"
    case "confirm":
      return "confirm"
    default:
      return stepType as CheckoutStep
  }
}

/**
 * Products that belong to a step. Content-only templates and the confirm step
 * never carry products; a step with no `product_category` is silently empty;
 * otherwise products are matched case-insensitively by category and must be
 * active.
 */
export function resolveStepProducts(
  step: TicketingStep,
  products: CheckoutRuntimeProduct[],
): CheckoutRuntimeProduct[] {
  if (step.template && CONTENT_ONLY_TEMPLATES.has(step.template)) return []
  if (step.step_type === "confirm") return []
  if (!step.product_category) return []
  const target = step.product_category.toLowerCase()
  return products.filter(
    (p) => p.is_active !== false && (p.category ?? "").toLowerCase() === target,
  )
}

/** Build the `stepId → products` map for every configured step. */
export function buildProductsByStepId(
  steps: TicketingStep[],
  products: CheckoutRuntimeProduct[],
): Map<string, CheckoutRuntimeProduct[]> {
  const map = new Map<string, CheckoutRuntimeProduct[]>()
  for (const step of steps) {
    map.set(step.id, resolveStepProducts(step, products))
  }
  return map
}

/**
 * Whether a step is visible. Priority: disabled → hidden; structural steps
 * (confirm/buyer/tickets) → visible; content-only templates → visible; all
 * others → visible iff they resolved at least one product.
 */
export function isStepVisible(
  step: TicketingStep,
  productsForStep: CheckoutRuntimeProduct[],
): boolean {
  if (step.is_enabled === false) return false
  if (
    step.step_type === "confirm" ||
    step.step_type === "buyer" ||
    step.step_type === "tickets"
  ) {
    return true
  }
  if (step.template && CONTENT_ONLY_TEMPLATES.has(step.template)) {
    return true
  }
  return productsForStep.length > 0
}

/**
 * The ordered list of visible checkout steps. Falls back to a safe minimum
 * (`["passes", "confirm"]`) until the API step config has loaded.
 */
export function deriveAvailableSteps(
  configuredSteps: TicketingStep[],
  productsByStepId: Map<string, CheckoutRuntimeProduct[]>,
): CheckoutStep[] {
  if (configuredSteps.length === 0) {
    return ["passes", "confirm"]
  }
  const steps: CheckoutStep[] = []
  for (const step of configuredSteps) {
    const productsForStep = productsByStepId.get(step.id) ?? []
    if (!isStepVisible(step, productsForStep)) continue
    const checkoutStep = toCheckoutStep(step.step_type)
    if (!checkoutStep) continue
    steps.push(checkoutStep)
  }
  return steps
}
