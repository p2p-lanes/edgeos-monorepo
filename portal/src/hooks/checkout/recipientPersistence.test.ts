// @vitest-environment node

import { describe, expect, it, vi } from "vitest"
import {
  buildCheckoutRecipientDraft,
  type CheckoutRecipientDraft,
  type CheckoutRecipientPassState,
  type SelectedPassItem,
} from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"
import { type CartState, EMPTY_CART } from "../useCartApi"
import { buildPersistedPassSelections } from "./useCartPersistence"
import {
  buildItemsSnapshot,
  hydrateFromSnapshot,
} from "./useOpenCartPersistence"

const product = {
  id: "ticket-1",
  name: "Ticket",
  category: "ticket",
  price: 100,
  is_active: true,
} as ProductsPass

function selection(
  attendeeId: string,
  recipient?: CheckoutRecipientDraft,
): SelectedPassItem {
  return {
    attendeeId,
    attendee: {
      id: attendeeId,
      products: [],
      recipient,
    } as CheckoutRecipientPassState,
    recipient,
    productId: product.id,
    product,
    quantity: 1,
    price: 100,
  }
}

function state(selectedPasses: SelectedPassItem[]) {
  return {
    selectedPasses,
    housing: null,
    merch: [],
    patron: null,
    selectedMealPlans: [],
    dynamicItems: {},
    promoCode: "",
    promoCodeValid: false,
    insurance: false,
    currentStep: "passes" as const,
  }
}

describe("recipient draft persistence", () => {
  it("types legacy and recipient cart lines and clears recipient snapshots", () => {
    const legacyCart: CartState = {
      ...EMPTY_CART,
      passes: [
        { attendee_id: "legacy-attendee", product_id: "ticket-1", quantity: 1 },
      ],
      housing: {
        product_id: "housing-1",
        check_in: "2026-08-27",
        check_out: "2026-08-29",
        quantity: 2,
      },
    }
    const recipientCart: CartState = {
      ...EMPTY_CART,
      passes: [
        { recipient_key: "managed-kid", product_id: "ticket-1", quantity: 1 },
      ],
      recipients: [
        {
          recipient_key: "managed-kid",
          name: "Taylor Kid",
          profile_snapshot: { category: "kid" },
        },
      ],
    }

    expect(legacyCart.housing?.quantity).toBe(2)
    expect(recipientCart.passes[0]).toEqual({
      recipient_key: "managed-kid",
      product_id: "ticket-1",
      quantity: 1,
    })
    expect(EMPTY_CART.recipients).toEqual([])
  })

  it("keeps a stable linked-Human buyer key and profile", () => {
    const attendee = {
      id: "buyer-attendee",
      human_id: "human-buyer",
      name: "Alex Buyer",
      email: "alex@example.com",
      category_id: "category-main",
      category: "main",
      gender: "nonbinary",
      additional_data: { residence: "Lisbon" },
    } as CheckoutRecipientPassState

    const recipient = buildCheckoutRecipientDraft(attendee)

    expect(recipient).toEqual({
      recipient_key: "human:human-buyer",
      human_id: "human-buyer",
      name: "Alex Buyer",
      email: "alex@example.com",
      category_id: "category-main",
      profile_snapshot: {
        residence: "Lisbon",
        category: "main",
        gender: "nonbinary",
      },
    })
    expect(buildCheckoutRecipientDraft(attendee).recipient_key).toBe(
      recipient.recipient_key,
    )
  })

  it("preserves a managed spouse key, explicit reuse ID, and optional category", () => {
    const recipient = {
      recipient_key: "managed-spouse",
      existing_attendee_id: "spouse-attendee",
      name: "Sam Spouse",
      email: "sam@example.com",
      category_id: "category-spouse",
      profile_snapshot: { category: "spouse", dietary_notes: "vegetarian" },
    }
    const attendee = {
      id: "recipient:managed-spouse",
      name: recipient.name,
      products: [],
      recipient,
    } as CheckoutRecipientPassState

    expect(buildCheckoutRecipientDraft(attendee)).toEqual(recipient)
  })

  it("saves authenticated recipient lines and keeps legacy attendee lines", () => {
    const spouse = {
      recipient_key: "managed-spouse",
      existing_attendee_id: "spouse-attendee",
      name: "Sam Spouse",
      profile_snapshot: { category: "spouse" },
    }

    expect(
      buildPersistedPassSelections([
        selection("recipient:managed-spouse", spouse),
        selection("legacy-attendee"),
      ]),
    ).toEqual({
      passes: [
        {
          recipient_key: "managed-spouse",
          product_id: "ticket-1",
          quantity: 1,
        },
        { attendee_id: "legacy-attendee", product_id: "ticket-1", quantity: 1 },
      ],
      recipients: [spouse],
    })
  })

  it("round-trips an anonymous managed kid without regenerating identity", () => {
    const kid = {
      recipient_key: "managed-kid",
      name: "Taylor Kid",
      category_id: "category-kid",
      profile_snapshot: { category: "kid", age_group: "under_12" },
    }
    const first = buildItemsSnapshot(
      state([selection("recipient:managed-kid", kid)]),
    )
    const second = buildItemsSnapshot(
      state([selection("recipient:managed-kid", first.recipients[0])]),
    )

    expect(first.passes[0]).toEqual({
      recipient_key: "managed-kid",
      product_id: "ticket-1",
      quantity: 1,
    })
    expect(second.recipients).toEqual([kid])
  })

  it("hydrates recipient-keyed selections through the open-cart reload path", () => {
    const restorePassRecipients = vi.fn()
    const snapshot = buildItemsSnapshot(
      state([
        selection("recipient:managed-kid", {
          recipient_key: "managed-kid",
          name: "Taylor Kid",
          profile_snapshot: { category: "kid" },
        }),
      ]),
    )

    hydrateFromSnapshot(snapshot, [product], false, {
      setHousing: vi.fn(),
      setMerch: vi.fn(),
      setPatron: vi.fn(),
      setMealPlans: vi.fn(),
      setInsurance: vi.fn(),
      setDynamicItems: vi.fn(),
      restorePassRecipients,
    })

    expect(restorePassRecipients).toHaveBeenCalledWith(
      snapshot.recipients,
      snapshot.passes,
    )
  })

  it("keeps legacy attendee lines unchanged and emits no recipient snapshot", () => {
    expect(
      buildPersistedPassSelections([selection("legacy-attendee")]),
    ).toEqual({
      passes: [
        {
          attendee_id: "legacy-attendee",
          product_id: "ticket-1",
          quantity: 1,
        },
      ],
      recipients: [],
    })
  })
})
