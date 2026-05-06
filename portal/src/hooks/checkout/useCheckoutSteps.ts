import { useCallback, useMemo, useState } from "react"
import type { TicketingStepPublic } from "@/client"
import { CONTENT_ONLY_TEMPLATES } from "@/components/checkout-flow/registries/variantRegistry"
import type { CheckoutStep } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"

interface UseCheckoutStepsParams {
  initialStep: CheckoutStep
  configuredSteps: TicketingStepPublic[]
  productsByStepId: Map<string, ProductsPass[]>
  selectedPassesCount: number
  dynamicItemsCount: number
  isEditing: boolean
  buyerInfoComplete?: boolean
}

/**
 * Maps API step_type values to internal CheckoutStep values.
 * "tickets" → "passes" for backwards compat with existing components.
 */
function toCheckoutStep(stepType: string): CheckoutStep | null {
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
 * Determines whether a step should be visible in the checkout flow.
 *
 * Rules (in priority order):
 * 1. If is_enabled=false → hidden.
 * 2. Structural steps (confirm, buyer, tickets) → always visible when enabled.
 * 3. Content-only template steps → always visible when enabled (no products).
 * 4. All others → visible iff the resolver map has ≥1 product for this step.
 */
function isStepVisible(
  stepConfig: TicketingStepPublic,
  productsForStep: ProductsPass[],
): boolean {
  if (!stepConfig.is_enabled) return false
  // Structural steps — driven by their own data source, not products.
  if (
    stepConfig.step_type === "confirm" ||
    stepConfig.step_type === "buyer" ||
    stepConfig.step_type === "tickets"
  ) {
    return true
  }
  // Content-only templates have no product requirement.
  if (stepConfig.template && CONTENT_ONLY_TEMPLATES.has(stepConfig.template)) {
    return true
  }
  // All other steps require at least one resolved product.
  return productsForStep.length > 0
}

export function useCheckoutSteps({
  initialStep,
  configuredSteps,
  productsByStepId,
  selectedPassesCount,
  dynamicItemsCount,
  isEditing,
  buyerInfoComplete = true,
}: UseCheckoutStepsParams) {
  const [currentStep, setCurrentStep] = useState<CheckoutStep>(initialStep)

  const availableSteps = useMemo<CheckoutStep[]>(() => {
    // If API config not yet loaded, fall back to safe minimum until config loads.
    if (configuredSteps.length === 0) {
      return ["passes", "confirm"]
    }

    // Build from API config (already is_enabled=true for most, ordered by order).
    const steps: CheckoutStep[] = []
    for (const stepConfig of configuredSteps) {
      const productsForStep = productsByStepId.get(stepConfig.id) ?? []
      if (!isStepVisible(stepConfig, productsForStep)) continue
      const checkoutStep = toCheckoutStep(stepConfig.step_type)
      if (!checkoutStep) continue
      steps.push(checkoutStep)
    }

    return steps
  }, [configuredSteps, productsByStepId])

  const goToStep = useCallback((step: CheckoutStep) => {
    setCurrentStep(step)
  }, [])

  const goToNextStep = useCallback(() => {
    const currentIndex = availableSteps.indexOf(currentStep)
    if (currentIndex < availableSteps.length - 1) {
      setCurrentStep(availableSteps[currentIndex + 1])
    }
  }, [currentStep, availableSteps])

  const goToPreviousStep = useCallback(() => {
    const currentIndex = availableSteps.indexOf(currentStep)
    if (currentIndex > 0) {
      setCurrentStep(availableSteps[currentIndex - 1])
    }
  }, [currentStep, availableSteps])

  const canProceedToStep = useCallback(
    (step: CheckoutStep): boolean => {
      const targetIndex = availableSteps.indexOf(step)

      if (isEditing) {
        return selectedPassesCount > 0
      }

      if (
        targetIndex > 0 &&
        selectedPassesCount === 0 &&
        dynamicItemsCount === 0
      ) {
        return false
      }

      const buyerIndex = availableSteps.indexOf("buyer")
      if (buyerIndex >= 0 && targetIndex > buyerIndex && !buyerInfoComplete) {
        return false
      }

      return true
    },
    [
      selectedPassesCount,
      dynamicItemsCount,
      availableSteps,
      isEditing,
      buyerInfoComplete,
    ],
  )

  const isStepComplete = useCallback(
    (step: CheckoutStep): boolean => {
      switch (step) {
        case "passes":
        case "tickets":
          return selectedPassesCount > 0
        case "housing":
        case "merch":
        case "patron":
        case "confirm":
          return false
        default:
          return false
      }
    },
    [selectedPassesCount],
  )

  return {
    currentStep,
    setCurrentStep,
    availableSteps,
    goToStep,
    goToNextStep,
    goToPreviousStep,
    canProceedToStep,
    isStepComplete,
  }
}
