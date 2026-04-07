"use client"

import type { ComponentType } from "react"
import type { TicketingStepPublic } from "@/client"
import { Button } from "@/components/ui/button"
import { useCheckout } from "@/providers/checkoutProvider"
import type { ProductsPass } from "@/types/Products"
import VariantHousingDate from "./variants/VariantHousingDate"
import VariantMerchImage from "./variants/VariantMerchImage"
import VariantPatronPreset from "./variants/VariantPatronPreset"
import VariantTicketSelect from "./variants/VariantTicketSelect"

export interface VariantProps {
  products: ProductsPass[]
  stepType: string
  onSkip?: () => void
  templateConfig?: Record<string, unknown> | null
}

const VARIANT_REGISTRY: Record<string, ComponentType<VariantProps>> = {
  "ticket-select": VariantTicketSelect,
  "patron-preset": VariantPatronPreset,
  "housing-date": VariantHousingDate,
  "merch-image": VariantMerchImage,
}

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

  if (!VariantComponent || filtered.length === 0) {
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
