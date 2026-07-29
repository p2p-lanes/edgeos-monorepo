import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CheckoutPreviewResponse, ProductLine } from "../types/api"
import { createPricingDriver } from "./driver"

function preview(total: string): CheckoutPreviewResponse {
  return {
    lines: [],
    discountable_amount: total,
    non_discountable_amount: "0",
    discount_amount: "0",
    post_discount_amount: total,
    insurance_amount: "0",
    contribution_amount: "0",
    total,
    currency: "USD",
  }
}

const A: ProductLine = { product_id: "a", quantity: 1 }
const B: ProductLine = { product_id: "b", quantity: 2 }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("createPricingDriver", () => {
  it("debounces rapid updates into one call with the latest input", async () => {
    const client = { preview: vi.fn().mockResolvedValue(preview("20")) }
    const driver = createPricingDriver({ client, debounceMs: 300 })

    driver.update({ products: [A] })
    driver.update({ products: [B], insurance: true })
    expect(client.preview).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)

    expect(client.preview).toHaveBeenCalledTimes(1)
    expect(client.preview).toHaveBeenCalledWith({
      products: [B],
      coupon_code: null,
      insurance: true,
    })
    expect(driver.getState().status).toBe("success")
    expect(driver.getState().preview?.total).toBe("20")
  })

  it("goes idle and never calls when there are no lines", async () => {
    const client = { preview: vi.fn().mockResolvedValue(preview("0")) }
    const driver = createPricingDriver({ client, debounceMs: 100 })

    driver.update({ products: [] })
    await vi.advanceTimersByTimeAsync(100)

    expect(client.preview).not.toHaveBeenCalled()
    expect(driver.getState()).toEqual({ status: "idle", preview: null, error: null })
  })

  it("captures errors into the error state", async () => {
    const client = { preview: vi.fn().mockRejectedValue(new Error("boom")) }
    const driver = createPricingDriver({ client, debounceMs: 50 })

    driver.update({ products: [A] })
    await vi.advanceTimersByTimeAsync(50)

    expect(driver.getState().status).toBe("error")
    expect(driver.getState().error).toBeInstanceOf(Error)
  })

  it("flush fires the pending preview immediately", async () => {
    const client = { preview: vi.fn().mockResolvedValue(preview("5")) }
    const driver = createPricingDriver({ client, debounceMs: 10_000 })

    driver.update({ products: [A] })
    await driver.flush()

    expect(client.preview).toHaveBeenCalledTimes(1)
    expect(driver.getState().preview?.total).toBe("5")
  })

  it("last-write-wins: a stale response never overwrites a newer one", async () => {
    const resolvers: Array<(v: CheckoutPreviewResponse) => void> = []
    const client = {
      preview: vi.fn().mockImplementation(
        () => new Promise<CheckoutPreviewResponse>((r) => resolvers.push(r)),
      ),
    }
    const driver = createPricingDriver({ client, debounceMs: 100 })

    driver.update({ products: [A] })
    await vi.advanceTimersByTimeAsync(100) // fire #1 (pending)
    driver.update({ products: [B] })
    await vi.advanceTimersByTimeAsync(100) // fire #2 (pending)
    expect(client.preview).toHaveBeenCalledTimes(2)

    // Newer request resolves first…
    resolvers[1](preview("newer"))
    await vi.advanceTimersByTimeAsync(0)
    expect(driver.getState().preview?.total).toBe("newer")

    // …then the stale earlier response arrives and is ignored.
    resolvers[0](preview("stale"))
    await vi.advanceTimersByTimeAsync(0)
    expect(driver.getState().preview?.total).toBe("newer")
  })

  it("notifies subscribers on state changes", async () => {
    const client = { preview: vi.fn().mockResolvedValue(preview("9")) }
    const driver = createPricingDriver({ client, debounceMs: 50 })
    const seen: string[] = []
    driver.subscribe((s) => seen.push(s.status))

    driver.update({ products: [A] })
    await vi.advanceTimersByTimeAsync(50)

    expect(seen).toContain("loading")
    expect(seen).toContain("success")
  })
})
