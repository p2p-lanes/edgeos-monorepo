// Pure navigation + gating helpers ported from `useCheckoutSteps.ts`. The
// portal held `currentStep` in React state; here the caller owns state and
// passes it in, so these stay deterministic and testable.

import type { CheckoutStep } from "../types/checkout"

/** The step after `current`, or `current` itself when already last/unknown. */
export function nextStep(
  availableSteps: CheckoutStep[],
  current: CheckoutStep,
): CheckoutStep {
  const i = availableSteps.indexOf(current)
  if (i >= 0 && i < availableSteps.length - 1) return availableSteps[i + 1]
  return current
}

/** The step before `current`, or `current` itself when already first/unknown. */
export function previousStep(
  availableSteps: CheckoutStep[],
  current: CheckoutStep,
): CheckoutStep {
  const i = availableSteps.indexOf(current)
  if (i > 0) return availableSteps[i - 1]
  return current
}

export interface ProceedGateInput {
  availableSteps: CheckoutStep[]
  selectedPassesCount: number
  dynamicItemsCount: number
  isEditing: boolean
  /** Defaults to true — a missing buyer step never blocks. */
  buyerInfoComplete?: boolean
}

/**
 * Whether the buyer may navigate to `step`. When editing, only requires at
 * least one selected pass. Otherwise: any step past the first needs a
 * selection (pass or dynamic item), and any step past the buyer step needs
 * the buyer info to be complete.
 */
export function canProceedToStep(
  step: CheckoutStep,
  input: ProceedGateInput,
): boolean {
  const {
    availableSteps,
    selectedPassesCount,
    dynamicItemsCount,
    isEditing,
    buyerInfoComplete = true,
  } = input
  const targetIndex = availableSteps.indexOf(step)

  if (isEditing) {
    return selectedPassesCount > 0
  }

  if (targetIndex > 0 && selectedPassesCount === 0 && dynamicItemsCount === 0) {
    return false
  }

  const buyerIndex = availableSteps.indexOf("buyer")
  if (buyerIndex >= 0 && targetIndex > buyerIndex && !buyerInfoComplete) {
    return false
  }

  return true
}

/** Whether a step counts as complete. Only the ticket steps have a rule today. */
export function isStepComplete(
  step: CheckoutStep,
  selectedPassesCount: number,
): boolean {
  switch (step) {
    case "passes":
    case "tickets":
      return selectedPassesCount > 0
    default:
      return false
  }
}
