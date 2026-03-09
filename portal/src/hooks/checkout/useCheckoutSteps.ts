import { useCallback, useMemo, useState } from "react"
import type { CheckoutStep } from "@/types/checkout"

interface UseCheckoutStepsParams {
  initialStep: CheckoutStep
  patronCount: number
  housingCount: number
  merchCount: number
  selectedPassesCount: number
  isEditing: boolean
}

export function useCheckoutSteps({
  initialStep,
  patronCount,
  housingCount,
  merchCount,
  selectedPassesCount,
  isEditing,
}: UseCheckoutStepsParams) {
  const [currentStep, setCurrentStep] = useState<CheckoutStep>(initialStep)

  const availableSteps = useMemo<CheckoutStep[]>(() => {
    const steps: CheckoutStep[] = ["passes"]

    if (patronCount > 0) steps.push("patron")
    if (housingCount > 0) steps.push("housing")
    if (merchCount > 0) steps.push("merch")

    steps.push("confirm")

    return steps
  }, [patronCount, housingCount, merchCount])

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
          return selectedPassesCount > 0
        case "housing":
        case "merch":
        case "patron":
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
