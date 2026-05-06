import type { TicketingStepPublic } from "@/client"

/**
 * Determine whether a step should use DynamicProductStep (template-driven).
 *
 * After STEP_COMPONENT_REGISTRY removal:
 * - confirm → always false (rendered explicitly in the calling flow)
 * - buyer → always false (rendered explicitly in the calling flow)
 * - tickets → true only when template_config is present (legacy PassSelectionSection fallback)
 * - all other steps → always true (every product step renders via DynamicProductStep)
 */
export function shouldUseDynamicStep(
  stepConfig: TicketingStepPublic | undefined,
): boolean {
  if (!stepConfig) return false
  if (stepConfig.step_type === "confirm") return false
  if (stepConfig.step_type === "buyer") return false
  if (stepConfig.step_type === "tickets") {
    // Tickets continue to support legacy PassSelectionSection when no template_config.
    // Safe fallback: always route tickets through DynamicProductStep when template exists.
    return !!stepConfig.template_config
  }
  // Every other step renders via DynamicProductStep (template required).
  return true
}
