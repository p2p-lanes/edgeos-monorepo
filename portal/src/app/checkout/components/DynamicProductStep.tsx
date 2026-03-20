"use client"

import type { ComponentType } from "react"
import type { TicketingStepPublic } from "@/client"
import { Button } from "@/components/ui/button"
import { useCheckout } from "@/providers/checkoutProvider"
import VariantHousingDate from "./variants/VariantHousingDate"
import VariantMerchImage from "./variants/VariantMerchImage"
import VariantPatronPreset from "./variants/VariantPatronPreset"
import VariantQuantitySpinner from "./variants/VariantQuantitySpinner"
import VariantTicketCard from "./variants/VariantTicketCard"
import VariantTicketSelect from "./variants/VariantTicketSelect"
import type { ProductsPass } from "@/types/Products"

interface VariantProps {
  products: ProductsPass[]
  stepType: string
  onSkip?: () => void
}

const VARIANT_REGISTRY: Record<string, ComponentType<VariantProps>> = {
  "ticket-select":    VariantTicketSelect,
  "ticket-card":      VariantTicketCard,
  "quantity-spinner": VariantQuantitySpinner,
  "patron-preset":    VariantPatronPreset,
  "housing-date":     VariantHousingDate,
  "merch-image":      VariantMerchImage,
}

interface DynamicProductStepProps {
  stepConfig: TicketingStepPublic
  onSkip?: () => void
}

export default function DynamicProductStep({ stepConfig, onSkip }: DynamicProductStepProps) {
  const { allProducts } = useCheckout()

  const filtered = allProducts.filter(
    (p) => p.category === stepConfig.product_category && p.is_active
  )

  const VariantComponent = stepConfig.display_variant
    ? VARIANT_REGISTRY[stepConfig.display_variant]
    : VARIANT_REGISTRY["ticket-select"]

  if (!VariantComponent || filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-gray-500 mb-6">No products available for this step.</p>
        <Button variant="outline" onClick={onSkip}>Continue</Button>
      </div>
    )
  }

  return (
    <VariantComponent
      products={filtered}
      stepType={stepConfig.step_type}
      onSkip={onSkip}
    />
  )
}
