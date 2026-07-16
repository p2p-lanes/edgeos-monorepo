import type { TicketingStepPublic } from "@/client"

export interface CheckoutSection {
  id: string
  stepType: string
  config: TicketingStepPublic | null
  label: string
  template: string | null
  emoji: string | null
  showInNavbar: boolean
}

const DEFAULT_LABELS: Record<string, string> = {
  passes: "Select Your Passes",
  tickets: "Select Your Passes",
  housing: "Choose Housing",
  merch: "Event Merchandise",
  patron: "Become a Patron",
  confirm: "Review & Confirm",
}

/** Walk availableSteps in funnel order, consuming one matching config per step.
 *  Duplicates (e.g. two housing rows) each get their OWN config and a
 *  disambiguated id (`housing-2` for the second) so React keys stay unique.
 *  Pure — identical output to ScrollyCheckoutFlow's inline `allSections`. */
export function deriveCheckoutSections(
  availableSteps: string[],
  stepConfigs: TicketingStepPublic[],
): CheckoutSection[] {
  const counts: Record<string, number> = {}
  const consumedConfigIds = new Set<string>()

  return availableSteps
    .filter((s) => s !== "success")
    .map((step) => {
      counts[step] = (counts[step] ?? 0) + 1
      const sectionId = counts[step] === 1 ? step : `${step}-${counts[step]}`

      const config =
        stepConfigs.find(
          (c) =>
            !consumedConfigIds.has(c.id) &&
            (c.step_type === step ||
              (c.step_type === "tickets" && step === "passes")),
        ) ?? null
      if (config) consumedConfigIds.add(config.id)

      return {
        id: sectionId,
        stepType: step,
        config,
        label: config?.title ?? DEFAULT_LABELS[step] ?? step,
        template: config?.template ?? null,
        emoji: config?.emoji ?? null,
        showInNavbar: config?.show_in_navbar ?? true,
      }
    })
}
