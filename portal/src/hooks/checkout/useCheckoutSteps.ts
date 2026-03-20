import { useCallback, useMemo, useState } from "react"
import type { TicketingStepPublic } from "@/client"
import type { CheckoutStep } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"

interface UseCheckoutStepsParams {
  initialStep: CheckoutStep
  configuredSteps: TicketingStepPublic[]
  patronCount: number
  housingCount: number
  merchCount: number
  selectedPassesCount: number
  isEditing: boolean
  allProducts?: ProductsPass[]
}

const KNOWN_STEPS = new Set(["tickets", "housing", "merch", "patron", "insurance_checkout", "confirm"])

/**
 * Maps API step_type values to internal CheckoutStep values.
 * "tickets" → "passes" for backwards compat with existing components.
 */
function toCheckoutStep(stepType: string): CheckoutStep | null {
  switch (stepType) {
    case "tickets":
      return "passes"
    case "housing":
      return "housing"
    case "merch":
      return "merch"
    case "patron":
      return "patron"
    case "insurance_checkout":
      return "insurance_checkout"
    case "confirm":
      return "confirm"
    default:
      return stepType as CheckoutStep
  }
}

export function useCheckoutSteps({
  initialStep,
  configuredSteps,
  patronCount,
  housingCount,
  merchCount,
  selectedPassesCount,
  isEditing,
  allProducts = [],
}: UseCheckoutStepsParams) {
  const [currentStep, setCurrentStep] = useState<CheckoutStep>(initialStep)

  const availableSteps = useMemo<CheckoutStep[]>(() => {
    // If API config not yet loaded, fall back to product-count-based defaults
    if (configuredSteps.length === 0) {
      const steps: CheckoutStep[] = ["passes"]
      if (patronCount > 0) steps.push("patron")
      if (housingCount > 0) steps.push("housing")
      if (merchCount > 0) steps.push("merch")
      steps.push("confirm")
      return steps
    }

    // Build from API config (already is_enabled=true, ordered by order)
    const steps: CheckoutStep[] = []
    for (const stepConfig of configuredSteps) {
      const step = toCheckoutStep(stepConfig.step_type)
      if (!step) continue

      // Filter built-in steps by product availability
      if (step === "housing" && housingCount === 0) continue
      if (step === "merch" && merchCount === 0) continue
      if (step === "patron" && patronCount === 0) continue

      // For custom (non-built-in) steps, skip if no products match the category
      if (!KNOWN_STEPS.has(stepConfig.step_type) && stepConfig.product_category) {
        const hasProducts = allProducts.some(
          (p) => p.category === stepConfig.product_category && p.is_active
        )
        if (!hasProducts) continue
      }

      steps.push(step)
    }

    return steps
  }, [configuredSteps, patronCount, housingCount, merchCount, allProducts])

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

      if (targetIndex > 0 && selectedPassesCount === 0) {
        return false
      }

      return true
    },
    [selectedPassesCount, availableSteps, isEditing],
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
        case "insurance_checkout":
          return true
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
