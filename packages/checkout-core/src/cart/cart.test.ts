import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  emptySelection,
  selectHousing,
  setCoupon,
  setInsurance,
  setQuantity,
} from "../selection/state"
import type { CartState, OpenCartPublic } from "../types/api"
import { createCartDriver } from "./driver"
import { cartStateToSelection, selectionToCartState } from "./mapping"

function openCart(over: Partial<OpenCartPublic> & { items: CartState }): OpenCartPublic {
  return {
    id: over.id ?? "cart-1",
    popup_id: "p",
    email: "a@b.co",
    restore_token: over.restore_token ?? "tok",
    ...over,
  }
}

describe("selectionToCartState", () => {
  it("maps quantities to merch and housing to dates", () => {
    let s = setQuantity(emptySelection(), "p1", 2)
    s = setCoupon(setInsurance(s, true), "SAVE")
    s = selectHousing(s, {
      productId: "h1",
      checkIn: "2026-08-01",
      checkOut: "2026-08-04",
    })
    expect(selectionToCartState(s, { currentStep: "buyer" })).toEqual({
      passes: [],
      housing: { product_id: "h1", check_in: "2026-08-01", check_out: "2026-08-04" },
      merch: [{ product_id: "p1", quantity: 2 }],
      patron: null,
      meal_plans: [],
      promo_code: "SAVE",
      insurance: true,
      current_step: "buyer",
    })
  })
})

describe("cartStateToSelection", () => {
  it("merges merch/passes/patron into quantities and restores housing", () => {
    const cart: CartState = {
      merch: [{ product_id: "p1", quantity: 2 }],
      passes: [{ attendee_id: "a", product_id: "p1", quantity: 1 }],
      patron: { product_id: "pat", amount: 50, is_custom_amount: true },
      housing: { product_id: "h1", check_in: "2026-08-01", check_out: "2026-08-03" },
      promo_code: "SAVE",
      insurance: true,
    }
    const s = cartStateToSelection(cart)
    expect(s.quantities).toEqual({ p1: 3, pat: 1 })
    expect(s.housing?.nights).toBe(2)
    expect(s.insurance).toBe(true)
    expect(s.couponCode).toBe("SAVE")
  })

  it("round-trips a selection through cart state", () => {
    let s = setQuantity(emptySelection(), "p1", 2)
    s = setQuantity(s, "p2", 1)
    s = setInsurance(s, true)
    s = selectHousing(s, {
      productId: "h1",
      checkIn: "2026-08-01",
      checkOut: "2026-08-04",
    })
    const back = cartStateToSelection(selectionToCartState(s))
    expect(back.quantities).toEqual({ p1: 2, p2: 1 })
    expect(back.housing?.checkIn).toBe("2026-08-01")
    expect(back.housing?.checkOut).toBe("2026-08-04")
    expect(back.insurance).toBe(true)
  })
})

describe("createCartDriver", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("debounces save into one upsert and updates meta", async () => {
    const upsertCart = vi.fn().mockResolvedValue(openCart({ id: "cart-9", items: {} }))
    const client = { upsertCart, restoreCart: vi.fn() }
    const driver = createCartDriver({ client, debounceMs: 800 })

    driver.save("a@b.co", setQuantity(emptySelection(), "p1", 2))
    driver.save("a@b.co", setQuantity(emptySelection(), "p1", 3))
    expect(upsertCart).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(800)

    expect(upsertCart).toHaveBeenCalledTimes(1)
    expect(upsertCart).toHaveBeenCalledWith({
      email: "a@b.co",
      items: expect.objectContaining({ merch: [{ product_id: "p1", quantity: 3 }] }),
    })
    expect(driver.getMeta()).toEqual({ cartId: "cart-9", restoreToken: "tok" })
  })

  it("does not upsert without a valid email", async () => {
    const upsertCart = vi.fn().mockResolvedValue(openCart({ items: {} }))
    const client = { upsertCart, restoreCart: vi.fn() }
    const driver = createCartDriver({ client, debounceMs: 100 })

    driver.save("", setQuantity(emptySelection(), "p1", 1))
    await vi.advanceTimersByTimeAsync(100)

    expect(upsertCart).not.toHaveBeenCalled()
  })

  it("flush upserts immediately and returns meta", async () => {
    const upsertCart = vi.fn().mockResolvedValue(openCart({ id: "c-flush", items: {} }))
    const client = { upsertCart, restoreCart: vi.fn() }
    const driver = createCartDriver({ client, debounceMs: 10_000 })

    const meta = await driver.flush("a@b.co", setQuantity(emptySelection(), "p1", 1))

    expect(upsertCart).toHaveBeenCalledTimes(1)
    expect(meta).toEqual({ cartId: "c-flush", restoreToken: "tok" })
  })

  it("restore hydrates a selection and sets meta", async () => {
    const restoreCart = vi.fn().mockResolvedValue(
      openCart({
        id: "c-restore",
        restore_token: "sig-tok",
        items: { merch: [{ product_id: "p1", quantity: 2 }], insurance: true },
      }),
    )
    const client = { upsertCart: vi.fn(), restoreCart }
    const driver = createCartDriver({ client })

    const { selection, meta } = await driver.restore("c-restore", "the-sig")

    expect(restoreCart).toHaveBeenCalledWith("c-restore", "the-sig")
    expect(selection.quantities).toEqual({ p1: 2 })
    expect(selection.insurance).toBe(true)
    expect(meta).toEqual({ cartId: "c-restore", restoreToken: "sig-tok" })
  })

  it("clear resets meta and cancels a pending save", async () => {
    const upsertCart = vi.fn().mockResolvedValue(openCart({ items: {} }))
    const client = { upsertCart, restoreCart: vi.fn() }
    const driver = createCartDriver({ client, debounceMs: 500 })

    driver.save("a@b.co", setQuantity(emptySelection(), "p1", 1))
    driver.clear()
    await vi.advanceTimersByTimeAsync(500)

    expect(upsertCart).not.toHaveBeenCalled()
    expect(driver.getMeta()).toEqual({ cartId: null, restoreToken: null })
  })
})
