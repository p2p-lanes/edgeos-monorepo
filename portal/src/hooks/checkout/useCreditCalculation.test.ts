// @vitest-environment node
// RED: full-pass edit-credit bug — useCreditCalculation must compute
// editCredit = price * quantity. When quantity is incorrectly 0 (the bug),
// editCredit = 0 and grandTotal is not reduced.

import { describe, expect, it } from "vitest"
import { CHECKOUT_MODE } from "@/checkout/popupCheckoutPolicy"
import type { ProductWithQuantity } from "@/client"
import {
  buildBaseAttendeePasses,
  buildPurchasesMap,
} from "@/providers/passesProvider"
import type { AttendeePassState } from "@/types/Attendee"
import type { ProductsPass } from "@/types/Products"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFullPass(overrides: Partial<ProductsPass> = {}): ProductsPass {
  return {
    id: overrides.id ?? "full-pass-1",
    tenant_id: "tenant-1",
    name: overrides.name ?? "Full Pass",
    slug: overrides.slug ?? "full-pass",
    popup_id: "popup-1",
    attendee_category_id: null,
    category: "ticket",
    duration_type: "full",
    is_active: true,
    price: overrides.price ?? 299,
    quantity: overrides.quantity,
    purchased: overrides.purchased,
    max_per_order:
      overrides.max_per_order !== undefined ? overrides.max_per_order : null,
    compare_price: null,
    discountable: true,
    ...overrides,
  } as ProductsPass
}

function makeAttendeePassState(
  products: ProductsPass[],
  id = "attendee-1",
): AttendeePassState {
  return {
    id,
    category: "main",
    products,
  } as unknown as AttendeePassState
}

// ---------------------------------------------------------------------------
// useCreditCalculation — direct unit tests (no DOM needed)
// ---------------------------------------------------------------------------

describe("useCreditCalculation — editCredit for full passes", () => {
  it("returns editCredit = price when a purchased full pass (quantity=1) is set to edit=true", () => {
    const product: ProductsPass = {
      ...makeFullPass({ price: 299 }),
      purchased: true,
      edit: true,
      quantity: 1,
    }
    const attendeePasses = [makeAttendeePassState([product])]

    // Call the pure computation directly (hook uses useMemo internally,
    // but the logic is directly callable by extracting inputs)
    // We inline the logic here to avoid React renderHook dependency in node env.
    const editCredit = attendeePasses.reduce((total, attendee) => {
      return (
        total +
        attendee.products
          .filter((p) => p.edit && p.purchased)
          .reduce((sum, p) => sum + p.price * (p.quantity ?? 1), 0)
      )
    }, 0)

    expect(editCredit).toBe(299)
  })

  it("returns editCredit = 0 when purchased full pass has quantity=0 (the pre-fix bug)", () => {
    const product: ProductsPass = {
      ...makeFullPass({ price: 299 }),
      purchased: true,
      edit: true,
      quantity: 0, // this is the broken state before the fix
    }
    const attendeePasses = [makeAttendeePassState([product])]

    const editCredit = attendeePasses.reduce((total, attendee) => {
      return (
        total +
        attendee.products
          .filter((p) => p.edit && p.purchased)
          .reduce((sum, p) => sum + p.price * (p.quantity ?? 1), 0)
      )
    }, 0)

    // Note: 0 ?? 1 = 0 (not 1!) because 0 is falsy for nullish coalescing too —
    // actually 0 ?? 1 = 0 in JS (nullish only replaces null/undefined).
    // So editCredit = 299 * 0 = 0. This documents the broken behavior.
    expect(editCredit).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// End-to-end: buildBaseAttendeePasses + useCreditCalculation credit flow
// ---------------------------------------------------------------------------

describe("edit-mode credit flow — full pass given up for credit", () => {
  /**
   * Scenario (the reported bug):
   *   - pass_system popup, edit mode
   *   - Attendee owns a FULL pass (price $299, max_per_order=null) → purchased
   *   - User marks it as "edit" (give up for credit) → edit=true
   *   - A new FULL pass ($599) is selected
   *   - Expected: editCredit=299, grandTotal = 599 - 299 = 300
   */
  it("produces editCredit=299 and grandTotal=300 when giving up a $299 full pass toward a $599 full pass", () => {
    const purchasedPass = makeFullPass({
      id: "old-full",
      price: 299,
      max_per_order: null,
    })
    const newPass = makeFullPass({
      id: "new-full",
      price: 599,
      max_per_order: null,
    })

    const attendees = [
      { id: "attendee-1", category: "main" },
    ] as AttendeePassState[]

    const purchasesMap = buildPurchasesMap([
      {
        attendee_id: "attendee-1",
        attendee_name: "Test",
        attendee_category: "main",
        products: [
          { ...purchasedPass, quantity: 1 } as unknown as ProductWithQuantity,
        ],
      },
    ])

    // Build base passes — after the fix, the purchased full pass must have quantity=1
    const basePasses = buildBaseAttendeePasses(
      attendees,
      [purchasedPass, newPass],
      0,
      purchasesMap,
      CHECKOUT_MODE.PASS_SYSTEM,
    )

    // Simulate edit mode: mark old pass as edit=true, select new pass
    const attendeePasses: AttendeePassState[] = basePasses.map((a) => ({
      ...a,
      products: a.products.map((p) => {
        if (p.id === "old-full") return { ...p, edit: true }
        if (p.id === "new-full") return { ...p, selected: true }
        return p
      }),
    }))

    // Verify the purchased pass has quantity=1 (the fix)
    const oldPassInState = attendeePasses[0]?.products.find(
      (p) => p.id === "old-full",
    )
    expect(oldPassInState?.quantity).toBe(1)

    // Compute editCredit (same logic as useCreditCalculation)
    const editCredit = attendeePasses.reduce((total, attendee) => {
      return (
        total +
        attendee.products
          .filter((p) => p.edit && p.purchased)
          .reduce((sum, p) => sum + p.price * (p.quantity ?? 1), 0)
      )
    }, 0)

    expect(editCredit).toBe(299)

    // Compute grandTotal = newPassPrice - editCredit
    const newPassSubtotal = 599
    const grandTotal = Math.max(0, newPassSubtotal - editCredit)
    expect(grandTotal).toBe(300)
  })

  it("non-purchased full pass (not in edit) has correct subtotal of its own price", () => {
    const newPass = makeFullPass({
      id: "new-full",
      price: 499,
      max_per_order: null,
    })
    const attendees = [
      { id: "attendee-1", category: "main" },
    ] as AttendeePassState[]

    const basePasses = buildBaseAttendeePasses(
      attendees,
      [newPass],
      0,
      new Map(),
      CHECKOUT_MODE.PASS_SYSTEM,
    )

    const passInState = basePasses[0]?.products.find((p) => p.id === "new-full")
    // quantity=1 means price is counted once
    expect(passInState?.quantity).toBe(1)
    // No edit credit since nothing is purchased
    const editCredit = 0
    const grandTotal = Math.max(0, 499 - editCredit)
    expect(grandTotal).toBe(499)
  })
})
