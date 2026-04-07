import type { ComponentType } from "react"

import ConfirmStep from "./steps/ConfirmStep"
import HousingStep from "./steps/HousingStep"
import MerchSection from "./steps/MerchSection"
import PatronSection from "./steps/PatronSection"

/**
 * Registry mapping step_type values (from the API) to their React components.
 *
 * Note: "passes"/"tickets" and "success" are handled directly in CheckoutFlow
 * because they require special props (onAddAttendee, paymentStatus).
 *
 * To add a new step type (e.g. "airport_rides"):
 *   1. Create AirportRidesStep.tsx in ./steps/
 *   2. Add one import + one entry here
 *   3. Add the step_type to CheckoutStep in types/checkout.ts
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
