"use client"

import { useTranslation } from "react-i18next"
import type { TicketingStepPublic } from "@/client"
import { Button } from "@/components/ui/button"
import { useCheckout } from "@/providers/checkoutProvider"
import { PRODUCT_INDEPENDENT_TEMPLATES } from "./registries/templateClassification"
import { VARIANT_REGISTRY } from "./registries/variantRegistry"
import EditPassesToggle from "./shared/EditPassesToggle"

interface DynamicProductStepProps {
  stepConfig: TicketingStepPublic
  onSkip?: () => void
  isFirstSection?: boolean
}

/**
 * Whether this step has anything to sell.
 *
 * `getProductsForStep` answers by category, but a step built from sections
 * sells what its sections name. A door whose sections name nothing — the
 * shape a flow has before anyone assigns products to it, since "unassigned"
 * stopped meaning "in every flow" — passed that check on the strength of the
 * gathering's catalog and then rendered as a bare heading with an Add button
 * under it: no products, no explanation, nothing to tell it from a page that
 * failed to load (sdd/sales-flows-rediseno F3).
 */
export function stepOffersSomething(
  stepConfig: TicketingStepPublic,
  products: { id: string }[],
): boolean {
  const sections = (
    stepConfig.template_config as
      | { sections?: { product_ids?: string[] }[] }
      | null
      | undefined
  )?.sections

  // No sections is not the same as empty sections: a step that never
  // described itself that way is judged on its catalog, exactly as before.
  if (!sections || sections.length === 0) return products.length > 0

  const named = new Set(
    sections.flatMap((section) => section.product_ids ?? []),
  )
  if (named.size === 0) return false
  return products.some((product) => named.has(product.id))
}

export default function DynamicProductStep({
  stepConfig,
  onSkip,
  isFirstSection,
}: DynamicProductStepProps) {
  const { getProductsForStep, emptyCatalogReason } = useCheckout()
  const { t } = useTranslation()

  const filtered = getProductsForStep(stepConfig)

  const isProductIndependent = stepConfig.template
    ? PRODUCT_INDEPENDENT_TEMPLATES.has(stepConfig.template)
    : false

  // Explicit error state for non-ticket product steps missing a template.
  // This replaces the silent legacy-component fallback with a debuggable error.
  if (
    !stepConfig.template &&
    stepConfig.step_type !== "tickets" &&
    !isProductIndependent
  ) {
    // Only show error when there are products to display but no template.
    // When filtered is empty, show the standard empty state below.
    if (filtered.length > 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-gray-500 mb-2">
            {t("checkout.step_config_error")}
          </p>
          <p className="text-xs text-gray-400 mb-6">
            {t("checkout.step_config_error_detail")}
          </p>
          <Button variant="outline" onClick={onSkip}>
            {t("common.continue")}
          </Button>
        </div>
      )
    }
  }

  const VariantComponent = stepConfig.template
    ? VARIANT_REGISTRY[stepConfig.template]
    : VARIANT_REGISTRY["ticket-select"]

  if (
    !VariantComponent ||
    (!isProductIndependent && !stepOffersSomething(stepConfig, filtered))
  ) {
    // An empty step has more than one cause, and showing the same blank
    // message for all of them is what hid the original bug: a buyer turned
    // away by the flow's rule saw "no products", same as a flow nobody had
    // configured yet.
    const message =
      emptyCatalogReason === "flow_restriction_violated"
        ? t("checkout.not_eligible_for_flow")
        : t("checkout.no_products")

    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-gray-500 mb-6">{message}</p>
        <Button variant="outline" onClick={onSkip}>
          {t("common.continue")}
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
      isFirstSection={isFirstSection}
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
