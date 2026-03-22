import type { PaymentProductRequest } from "@/client"
import type { AttendeePassState } from "@/types/Attendee"
import type {
  SelectedDynamicItem,
  SelectedHousingItem,
  SelectedMerchItem,
  SelectedPassItem,
  SelectedPatronItem,
} from "@/types/checkout"

interface BuildPaymentProductsParams {
  attendeePasses: AttendeePassState[]
  selectedPasses: SelectedPassItem[]
  housing: SelectedHousingItem | null
  merch: SelectedMerchItem[]
  patron: SelectedPatronItem | null
  dynamicItems: Record<string, SelectedDynamicItem[]>
  isEditing: boolean
  appCredit: string | number | null | undefined
}

interface BuildPaymentProductsResult {
  products: PaymentProductRequest[]
  isMonthUpgrade: boolean
}

/**
 * Detects whether a month/full upgrade is happening (month or full selected
 * with existing week/day purchased, and no patron selected).
 */
function detectMonthUpgrade(attendeePasses: AttendeePassState[]): boolean {
  const fullOrMonthSelectedWithWeekOrDay = attendeePasses.some(
    (a) =>
      a.products.some(
        (p) =>
          (p.duration_type === "full" || p.duration_type === "month") &&
          p.selected &&
          !p.purchased,
      ) &&
      (a.products.some((p) => p.duration_type === "week" && p.purchased) ||
        a.products.some((p) => p.duration_type === "day" && p.purchased)),
  )
  const hasPatreonSelected = attendeePasses.some((a) =>
    a.products.some((p) => p.category === "patreon" && p.selected),
  )
  return fullOrMonthSelectedWithWeekOrDay && !hasPatreonSelected
}

/**
 * Pure function that builds the product list for the payment API.
 *
 * Handles ALL cases from both the checkout provider flow and the legacy
 * usePurchaseProducts flow:
 * - Normal pass purchase (selected, not purchased)
 * - Editing mode (edit_passes=true, include purchased products to keep)
 * - Month upgrade mode (month selected with existing week/day)
 * - Day pass quantity deltas (quantity - original_quantity)
 * - Housing, merch, and patron products
 */
export function buildPaymentProducts({
  attendeePasses,
  selectedPasses,
  housing,
  merch,
  patron,
  dynamicItems,
  isEditing,
  appCredit,
}: BuildPaymentProductsParams): BuildPaymentProductsResult {
  const isMonthUpgrade = detectMonthUpgrade(attendeePasses)
  const products: PaymentProductRequest[] = []

  if (isEditing) {
    // Editing mode: send kept + new products
    for (const attendee of attendeePasses) {
      for (const product of attendee.products) {
        // Kept: purchased and NOT given up for credit
        if (product.purchased && !product.edit) {
          products.push({
            product_id: product.id,
            attendee_id: attendee.id,
            quantity: product.quantity ?? 1,
          })
        }
        // New: selected and not previously purchased
        if (product.selected && !product.purchased) {
          products.push({
            product_id: product.id,
            attendee_id: attendee.id,
            quantity:
              product.duration_type === "day"
                ? (product.quantity ?? 1) - (product.original_quantity ?? 0)
                : (product.quantity ?? 1),
          })
        }
      }
    }
  } else {
    const hasAccountCredit = appCredit ? Number(appCredit) > 0 : false

    // When there's account credit or month upgrade, include purchased products
    // so the backend can recalculate totals with credits applied
    if (hasAccountCredit || isMonthUpgrade) {
      for (const attendee of attendeePasses) {
        const hasFullOrMonth = attendee.products.some(
          (p) =>
            (p.duration_type === "full" || p.duration_type === "month") &&
            (p.purchased || p.selected),
        )

        for (const product of attendee.products) {
          if (!product.purchased) continue
          // Skip week/day if upgrading to full/month
          if (
            hasFullOrMonth &&
            (product.duration_type === "week" ||
              product.duration_type === "day")
          )
            continue
          // Skip patron if a new patron is selected
          if (patron && product.category === "patreon") continue

          products.push({
            product_id: product.id,
            attendee_id: attendee.id,
            quantity: product.quantity ?? 1,
          })
        }
      }
    }

    // Add selected passes
    for (const pass of selectedPasses) {
      products.push({
        product_id: pass.productId,
        attendee_id: pass.attendeeId,
        quantity: pass.quantity,
      })
    }

    // Add merch
    for (const item of merch) {
      const firstAttendeeId = selectedPasses[0]?.attendeeId ?? ""
      products.push({
        product_id: item.productId,
        attendee_id: firstAttendeeId,
        quantity: item.quantity,
      })
    }

    // Add housing
    if (housing) {
      const firstAttendeeId = selectedPasses[0]?.attendeeId ?? ""
      products.push({
        product_id: housing.productId,
        attendee_id: firstAttendeeId,
        quantity: housing.nights,
      })
    }

    // Add patron
    if (patron) {
      const firstAttendeeId = selectedPasses[0]?.attendeeId ?? ""
      products.push({
        product_id: patron.productId,
        attendee_id: firstAttendeeId,
        quantity: 1,
      })
    }

    // Add dynamic step items
    const firstAttendeeId = selectedPasses[0]?.attendeeId ?? ""
    for (const items of Object.values(dynamicItems)) {
      for (const item of items) {
        if (item.quantity > 0) {
          products.push({
            product_id: item.productId,
            attendee_id: firstAttendeeId,
            quantity: item.quantity,
          })
        }
      }
    }
  }

  return { products, isMonthUpgrade }
}
