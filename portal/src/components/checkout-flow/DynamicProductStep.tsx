"use client"

import type { TicketingStepPublic } from "@/client"
import { Button } from "@/components/ui/button"
import { useCheckout } from "@/providers/checkoutProvider"
import {
  CONTENT_ONLY_TEMPLATES,
  VARIANT_REGISTRY,
} from "./registries/variantRegistry"

interface DynamicProductStepProps {
  stepConfig: TicketingStepPublic
  onSkip?: () => void
}

export default function DynamicProductStep({
  stepConfig,
  onSkip,
}: DynamicProductStepProps) {
  const { allProducts } = useCheckout()

  const filtered = allProducts.filter(
    (p) => p.category === stepConfig.product_category && p.is_active,
  )

  const VariantComponent = stepConfig.template
    ? VARIANT_REGISTRY[stepConfig.template]
    : VARIANT_REGISTRY["ticket-select"]

  const isContentOnly = stepConfig.template
    ? CONTENT_ONLY_TEMPLATES.has(stepConfig.template)
    : false

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

  return (
    <VariantComponent
      products={filtered}
      stepType={stepConfig.step_type}
      onSkip={onSkip}
      templateConfig={
        (stepConfig.template_config as Record<string, unknown>) ?? null
      }
    />
  )
}
