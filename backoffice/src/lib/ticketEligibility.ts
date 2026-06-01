import type { ProductPublic, TicketingStepPublic } from "@/client"

/**
 * Which ticket products an attendee of a given category may be assigned.
 *
 * Mirrors the portal's checkout segmentation (VariantTicketSelect): a ticket
 * product is purchasable only if it sits in a `ticket-select` step section whose
 * `attendee_categories` is null (open to all) or includes the attendee's
 * category id. `product.attendee_category_id` plays no role — segmentation lives
 * in the ticketing step's `template_config.sections`.
 *
 * Form-answer gating (`section.visible_if`) is intentionally NOT applied here:
 * an admin assigning tickets is not filling the application form, so we only
 * segment by attendee category.
 */
export type TicketEligibility = {
  // Lower-cased product categories that ARE segmented by a ticket-select step.
  sectionedCategories: Set<string>
  // Product ids visible to this attendee's category across visible sections.
  eligibleProductIds: Set<string>
}

type Section = {
  product_ids?: unknown
  attendee_categories?: unknown
}

export function computeTicketEligibility(
  steps: TicketingStepPublic[],
  attendeeCategoryId: string | null,
): TicketEligibility {
  const sectionedCategories = new Set<string>()
  const eligibleProductIds = new Set<string>()

  for (const step of steps) {
    if (step.is_enabled === false) continue
    if (step.template !== "ticket-select") continue

    const category = (step.product_category ?? "").toLowerCase()
    if (category) sectionedCategories.add(category)

    const config = (step.template_config ?? {}) as Record<string, unknown>
    const sections = Array.isArray(config.sections)
      ? (config.sections as Section[])
      : []

    for (const section of sections) {
      const productIds = Array.isArray(section.product_ids)
        ? section.product_ids.filter((x): x is string => typeof x === "string")
        : []
      const cats = section.attendee_categories
      const visible =
        cats == null ||
        (Array.isArray(cats) &&
          attendeeCategoryId != null &&
          cats.includes(attendeeCategoryId))
      if (visible) {
        for (const id of productIds) eligibleProductIds.add(id)
      }
    }
  }

  return { sectionedCategories, eligibleProductIds }
}

/**
 * True when a product can be assigned to the attendee. Products in a segmented
 * ticket category must be eligible; products outside any segmented category
 * (e.g. housing, merch, or popups without ticket-select steps) pass through.
 */
export function isProductAssignable(
  product: ProductPublic,
  eligibility: TicketEligibility,
): boolean {
  const category = (product.category ?? "").toLowerCase()
  if (!eligibility.sectionedCategories.has(category)) return true
  return eligibility.eligibleProductIds.has(product.id)
}
