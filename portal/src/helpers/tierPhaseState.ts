import type { PhaseState, TierPhasePublic } from "@/client"

export type TierPhaseUIState = {
  /** true when the current phase is not the purchasable one for its group */
  blocked: boolean
  /** short visual chip; null when there is no phase or the phase is active */
  badge: string | null
}

const BADGE_BY_STATE: Partial<Record<PhaseState, string>> = {
  upcoming: "Upcoming",
  sold_out: "Sold Out",
  expired: "Ended",
}

/** Resolve the UI treatment for a product's tier phase.
 *
 * Returns `blocked=false` and `badge=null` when the product has no phase
 * (non-tier product, backward-compatible). When a phase is present, we
 * rely on the server-derived `is_purchasable` + `sales_state` fields so
 * the frontend does not re-implement the progression cascade.
 */
export function resolveTierPhaseState(product: {
  phase?: TierPhasePublic | null
}): TierPhaseUIState {
  const phase = product.phase
  if (!phase) return { blocked: false, badge: null }
  const blocked = !phase.is_purchasable
  if (!blocked) return { blocked: false, badge: null }
  const badge = BADGE_BY_STATE[phase.sales_state] ?? "Coming next"
  return { blocked, badge }
}
