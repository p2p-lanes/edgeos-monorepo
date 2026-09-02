import {
  CHECKOUT_MODE,
  type CheckoutMode,
} from "@/checkout/popupCheckoutPolicy"
import type {
  PaymentProductRequest_Input as PaymentProductRequest,
  PaymentRecipientRequest,
} from "@/client"
import type { AttendeePassState } from "@/types/Attendee"
import type {
  SelectedAccommodationItem,
  SelectedDynamicItem,
  SelectedHousingItem,
  SelectedMealPlanItem,
  SelectedMerchItem,
  SelectedPassItem,
  SelectedPatronItem,
} from "@/types/checkout"

interface BuildPaymentProductsParams {
  attendeePasses: AttendeePassState[]
  selectedPasses: SelectedPassItem[]
  housing: SelectedHousingItem | null
  accommodations?: SelectedAccommodationItem[]
  merch: SelectedMerchItem[]
  patron: SelectedPatronItem | null
  selectedMealPlans?: SelectedMealPlanItem[]
  dynamicItems: Record<string, SelectedDynamicItem[]>
  isEditing: boolean
  appCredit: string | number | null | undefined
  checkoutMode?: CheckoutMode
  editPassesEnabled?: boolean
  submitMode?: "application" | "open-ticketing"
}

interface BuildPaymentProductsResult {
  products: PaymentProductRequest[]
  recipients: PaymentRecipientRequest[]
  isMonthUpgrade: boolean
}

/**
 * Detects whether a month/full upgrade is happening (month or full selected
 * with existing week/day purchased, and no patron selected).
 *
 * No category guard needed here: duration_type "month"/"full" is exclusively
 * used by ticket products. Non-ticket products (housing, merch, etc.) never
 * carry these duration types, so this filter is already ticket-scoped.
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
 * - Accommodation bookings (priced server-side from their dates)
 */
export function buildPaymentProducts({
  attendeePasses,
  selectedPasses,
  housing,
  accommodations = [],
  merch,
  patron,
  selectedMealPlans = [],
  dynamicItems,
  isEditing,
  appCredit,
  checkoutMode = CHECKOUT_MODE.PASS_SYSTEM,
  editPassesEnabled = false,
  submitMode = "application",
}: BuildPaymentProductsParams): BuildPaymentProductsResult {
  const isMonthUpgrade =
    editPassesEnabled &&
    checkoutMode === CHECKOUT_MODE.PASS_SYSTEM &&
    detectMonthUpgrade(attendeePasses)
  const products: PaymentProductRequest[] = []
  const recipients = new Map<string, PaymentRecipientRequest>()
  const accommodationAttendeeId =
    submitMode === "application"
      ? attendeePasses.find(
          (attendee) =>
            !attendee.id.startsWith("open-buyer-") &&
            !attendee.id.startsWith("recipient:"),
        )?.id
      : undefined
  const selectedPassesByIdentity = new Map(
    selectedPasses.map((pass) => [
      `${pass.attendeeId}:${pass.productId}`,
      pass,
    ]),
  )

  const recipientForAttendee = (
    attendee: AttendeePassState,
  ): PaymentRecipientRequest | undefined =>
    (attendee as AttendeePassState & { recipient?: PaymentRecipientRequest })
      .recipient

  const recipientIdentity = (
    attendeeId: string,
    recipient?: PaymentRecipientRequest,
  ): Pick<PaymentProductRequest, "attendee_id" | "recipient_key"> => {
    if (!recipient) return { attendee_id: attendeeId }

    if (!recipients.has(recipient.recipient_key)) {
      recipients.set(recipient.recipient_key, recipient)
    }
    return { recipient_key: recipient.recipient_key }
  }

  const passIdentity = (
    pass: SelectedPassItem,
  ): Pick<PaymentProductRequest, "attendee_id" | "recipient_key"> => {
    const attendee = attendeePasses.find(
      (candidate) => candidate.id === pass.attendeeId,
    )
    return recipientIdentity(
      pass.attendeeId,
      pass.recipient ?? recipientForAttendee(attendee ?? pass.attendee),
    )
  }

  const attendeeProductIdentity = (
    attendee: AttendeePassState,
    _product: SelectedPassItem["product"],
    selectedPass?: SelectedPassItem,
  ): Pick<PaymentProductRequest, "attendee_id" | "recipient_key"> => {
    return recipientIdentity(
      attendee.id,
      selectedPass?.recipient ?? recipientForAttendee(attendee),
    )
  }

  if (isEditing) {
    // Editing mode: send kept + new products
    for (const attendee of attendeePasses) {
      for (const product of attendee.products) {
        // Kept: purchased and NOT given up for credit
        if (product.purchased && !product.edit) {
          products.push({
            product_id: product.id,
            ...attendeeProductIdentity(attendee, product),
            quantity: product.quantity ?? 1,
          })
        }
        // New: selected and not previously purchased
        if (product.selected && !product.purchased) {
          const selectedPass = selectedPassesByIdentity.get(
            `${attendee.id}:${product.id}`,
          )
          products.push({
            product_id: product.id,
            ...attendeeProductIdentity(attendee, product, selectedPass),
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
            ...attendeeProductIdentity(attendee, product),
            quantity: product.quantity ?? 1,
          })
        }
      }
    }

    // Add selected passes
    const selectedPassProductIds = new Set<string>()
    for (const pass of selectedPasses) {
      selectedPassProductIds.add(pass.productId)
      products.push({
        product_id: pass.productId,
        ...passIdentity(pass),
        quantity: pass.quantity,
      })
    }

    // Add merch
    for (const item of merch) {
      products.push({
        product_id: item.productId,
        quantity: item.quantity,
      })
    }

    // Add housing
    if (housing) {
      const baseQty = housing.pricePerDay ? housing.nights : 1
      products.push({
        product_id: housing.productId,
        quantity: baseQty * (housing.quantity ?? 1),
      })
    }

    // Add patron
    if (patron) {
      products.push({
        product_id: patron.productId,
        quantity: 1,
        unit_price_override: patron.amount,
      })
    }

    // Add dynamic step items
    for (const items of Object.values(dynamicItems)) {
      for (const item of items) {
        // A restored legacy cart can contain the same ticket in dynamicItems
        // and selectedPasses. Keep the attendee-scoped representation.
        if (item.quantity > 0 && !selectedPassProductIds.has(item.productId)) {
          products.push({
            product_id: item.productId,
            quantity: item.quantity,
          })
        }
      }
    }

    // Add accommodations: one line per booked room, pointing at that room's
    // shadow product. No price travels: the backend re-quotes the stay from
    // the dates in `purchase_metadata` and charges that, so a tampered price
    // has nothing to tamper with. `quantity` must be 1, because a second room is a
    // second line, because each one is assigned its own unit.
    for (const item of accommodations) {
      products.push({
        product_id: item.productId,
        ...(accommodationAttendeeId
          ? { attendee_id: accommodationAttendeeId }
          : {}),
        quantity: 1,
        purchase_metadata: {
          kind: "accommodation_booking",
          accommodation_id: item.accommodationId,
          check_in: item.checkIn,
          check_out: item.checkOut,
          guest_count: item.guestCount,
          guests: item.guests
            .map((name) => name.trim())
            .filter(Boolean)
            .map((name) => ({ name })),
        },
      })
    }

    // Add meal plans — one PaymentProductRequest per (attendee, weekly product),
    // each carrying the per-purchase metadata blob the backend persists onto
    // AttendeeProducts.purchase_metadata.
    for (const item of selectedMealPlans) {
      const attendee = attendeePasses.find(
        (candidate) => candidate.id === item.attendeeId,
      )
      products.push({
        product_id: item.productId,
        ...recipientIdentity(
          item.attendeeId,
          attendee ? recipientForAttendee(attendee) : undefined,
        ),
        quantity: 1,
        purchase_metadata: {
          daily_choices: item.dailyChoices,
          dietary_restriction: item.dietaryRestriction,
          special_request: item.specialRequest,
        },
      })
    }
  }

  return { products, recipients: [...recipients.values()], isMonthUpgrade }
}
