import type { ComponentType } from "react"
import type { TicketingStepPublic } from "@/client"
import ConfirmStep from "../steps/ConfirmStep"
import HousingStep from "../steps/HousingStep"
import MerchSection from "../steps/MerchSection"
import PatronSection from "../steps/PatronSection"

/**
 * Registry mapping step_type values (from the API) to their fallback React components.
 * Used when a step has no template_config (i.e. not using the dynamic variant system).
 *
 * To add a new step type:
 *   1. Create the component in ../steps/
 *   2. Add one import + one entry here
 */
export const STEP_COMPONENT_REGISTRY: Record<
  string,
  ComponentType<{ onSkip?: () => void }>
> = {
  housing: HousingStep,
  merch: MerchSection,
  patron: PatronSection,
  confirm: ConfirmStep,
}

/**
 * Determine whether a step should use DynamicProductStep (template-driven)
 * or fall back to its hardcoded component from STEP_COMPONENT_REGISTRY.
 *
 * Consolidates the template_config checking logic that was previously
 * scattered across the renderSectionContent switch/case.
 */
export function shouldUseDynamicStep(
  stepConfig: TicketingStepPublic | undefined,
): boolean {
  if (!stepConfig?.template_config) return false
  const cfg = stepConfig.template_config as Record<string, unknown>

  // Steps with an explicit template always go dynamic
  if (stepConfig.template) return true

  // Housing: needs non-default variant or sections array
  if (stepConfig.step_type === "housing") {
    return (
      (cfg.variant != null && cfg.variant !== "default") ||
      (Array.isArray(cfg.sections) && cfg.sections.length > 0) ||
      cfg.price_per_day === false ||
      cfg.show_dates === false
    )
  }

  // Merch: needs non-default variant
  if (stepConfig.step_type === "merch") {
    return cfg.variant != null && cfg.variant !== "default"
  }

  // Default: having template_config means dynamic
  return true
}
