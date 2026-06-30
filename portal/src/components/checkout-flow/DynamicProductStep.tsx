"use client"

import type { TicketingStepPublic } from "@/client"
import { Button } from "@/components/ui/button"
import { useCheckout } from "@/providers/checkoutProvider"
import {
  CONTENT_ONLY_TEMPLATES,
  VARIANT_REGISTRY,
} from "./registries/variantRegistry"
import EditPassesToggle from "./shared/EditPassesToggle"

interface DynamicProductStepProps {
  stepConfig: TicketingStepPublic
  onSkip?: () => void
}

export default function DynamicProductStep({
  stepConfig,
  onSkip,
}: DynamicProductStepProps) {
  const { getProductsForStep } = useCheckout()

  const filtered = getProductsForStep(stepConfig)

  const isContentOnly = stepConfig.template
    ? CONTENT_ONLY_TEMPLATES.has(stepConfig.template)
    : false

  // Explicit error state for non-ticket product steps missing a template.
  // This replaces the silent legacy-component fallback with a debuggable error.
  if (
    !stepConfig.template &&
    stepConfig.step_type !== "tickets" &&
    !isContentOnly
  ) {
    // Only show error when there are products to display but no template.
    // When filtered is empty, show the standard empty state below.
    if (filtered.length > 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-gray-500 mb-2">Step configuration error.</p>
          <p className="text-xs text-gray-400 mb-6">
            No template assigned to this step. Please contact your
            administrator.
          </p>
          <Button variant="outline" onClick={onSkip}>
            Continue
          </Button>
        </div>
      )
    }
  }

  const VariantComponent = stepConfig.template
    ? VARIANT_REGISTRY[stepConfig.template]
    : VARIANT_REGISTRY["ticket-select"]

  if (!VariantComponent || (!isContentOnly && filtered.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-gray-500 mb-6">
          No products available for this step.
        </p>
        <Button variant="outline" onClick={onSkip}>
          Continue
        </Button>
      </div>
    )
  }

  const variant = (
    <VariantComponent
      products={filtered}
      stepType={stepConfig.step_type}
      onSkip={onSkip}
      templateConfig={
        (stepConfig.template_config as Record<string, unknown>) ?? null
      }
    />
  )

  // The edit-passes toggle is checkout-level functionality, agnostic to the
  // product template. Render it above the variant for the tickets step so it
  // appears regardless of which ticket template the popup uses.
  if (stepConfig.step_type === "tickets") {
    return (
      <div className="space-y-4">
        <EditPassesToggle />
        {variant}
      </div>
    )
  }

  return variant
}
