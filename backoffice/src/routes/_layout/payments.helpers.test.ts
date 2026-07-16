import { describe, expect, it } from "vitest"

import {
  buildPaymentsQueryConfig,
  buildPaymentsTableState,
  getRailAdjustment,
  resolveLineUnitPrice,
} from "./payments.helpers"

describe("payments.helpers", () => {
  it("forwards the server search term in query params and cache key", () => {
    const config = buildPaymentsQueryConfig({
      popupId: "popup-123",
      page: 2,
      pageSize: 25,
      search: "Lucia",
      statusFilter: "expired",
      sortBy: "amount",
      sortOrder: "asc",
    })

    expect(config.params).toEqual({
      skip: 50,
      limit: 25,
      popupId: "popup-123",
      search: "Lucia",
      paymentStatus: "expired",
      sortBy: "amount",
      sortOrder: "asc",
    })
    expect(config.queryKey).toEqual([
      "payments",
      "popup-123",
      {
        page: 2,
        pageSize: 25,
        search: "Lucia",
        statusFilter: "expired",
        sortBy: "amount",
        sortOrder: "asc",
      },
    ])
  })

  it("resolveLineUnitPrice: patron row uses effective_unit_price", () => {
    expect(
      resolveLineUnitPrice({
        effective_unit_price: "5000",
        product_price: "0",
      }),
    ).toBe(5000)
  })

  it("resolveLineUnitPrice: non-patron row uses product_price when effective_unit_price is null", () => {
    expect(
      resolveLineUnitPrice({
        effective_unit_price: null,
        product_price: "3000",
      }),
    ).toBe(3000)
  })

  it("resolveLineUnitPrice: non-patron row uses product_price when effective_unit_price is undefined", () => {
    expect(
      resolveLineUnitPrice({
        effective_unit_price: undefined,
        product_price: "2500",
      }),
    ).toBe(2500)
  })

  it("resolveLineUnitPrice: honours 0-value effective_unit_price (nullish coalescing, not truthy)", () => {
    // effective_unit_price=0 is a valid (if unusual) value — must NOT fall through to product_price
    expect(
      resolveLineUnitPrice({
        effective_unit_price: "0",
        product_price: "3000",
      }),
    ).toBe(0)
  })

  it("resolveLineUnitPrice: patron line total = unit_price * quantity", () => {
    const unitPrice = resolveLineUnitPrice({
      effective_unit_price: "5000",
      product_price: "0",
    })
    expect(unitPrice * 1).toBe(5000)
  })

  it("resolveLineUnitPrice: non-patron line total = product_price * quantity", () => {
    const unitPrice = resolveLineUnitPrice({
      effective_unit_price: null,
      product_price: "3000",
    })
    expect(unitPrice * 2).toBe(6000)
  })

  it("uses server totals and preserves server rows without local filtering", () => {
    const state = buildPaymentsTableState({
      payments: {
        results: [{ id: "payment-1" }, { id: "payment-2" }],
        paging: { total: 60 },
      },
      pagination: { pageIndex: 1, pageSize: 25 },
    })

    expect(state.data).toEqual([{ id: "payment-1" }, { id: "payment-2" }])
    expect(state.serverPagination).toEqual({
      total: 60,
      pagination: { pageIndex: 1, pageSize: 25 },
    })
  })

  it("derives a final charged adjustment without inferring a reason", () => {
    const adjustment = getRailAdjustment({
      id: "payment-final-adjustment",
      tenant_id: "tenant-1",
      popup_id: "popup-1",
      amount: "100.00",
      amount_charged: "95.00",
      currency: "USD",
      source: "SimpleFI",
      is_installment_plan: false,
      installments_total: 1,
      installments_paid: 1,
    })

    expect(adjustment).toMatchObject({
      pct: "5",
      isDiscount: true,
      final: true,
    })
  })

  it("treats a first installment as collected so far, not a final discount", () => {
    const adjustment = getRailAdjustment({
      id: "payment-installment-partial",
      tenant_id: "tenant-1",
      popup_id: "popup-1",
      amount: "500.00",
      amount_charged: "100.00",
      currency: "USD",
      source: "Stripe",
      is_installment_plan: true,
      installments_total: 5,
      installments_paid: 1,
    })

    expect(adjustment).toMatchObject({
      pct: "80",
      isDiscount: true,
      final: false,
    })
  })
})
