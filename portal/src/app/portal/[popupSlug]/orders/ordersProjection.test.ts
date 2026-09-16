import { describe, expect, it } from "vitest"
import type { PaymentPublic } from "@/client"
import { projectOrders } from "./ordersProjection"

describe("projectOrders", () => {
  it("keeps a merchandise payment's snapshot, total, and available invoice action", () => {
    const orders = projectOrders(
      [
        {
          id: "payment-merch",
          tenant_id: "tenant-1",
          popup_id: "popup-1",
          status: "approved",
          amount: "42.50",
          currency: "USD",
          sales_flow_id: "merch-flow",
          created_at: "2026-08-21T12:00:00Z",
          products_snapshot: [
            {
              product_id: "shirt",
              attendee_id: "buyer",
              product_name: "Event shirt",
              product_price: "25.00",
              effective_unit_price: "21.25",
              product_category: "merch",
              product_currency: "USD",
              quantity: 2,
              created_at: "2026-08-21T12:00:00Z",
            },
          ],
        } as PaymentPublic,
      ],
      true,
    )

    expect(orders).toEqual([
      {
        id: "payment-merch",
        status: "approved",
        provenance: "known",
        total: "42.50",
        currency: "USD",
        createdAt: "2026-08-21T12:00:00Z",
        invoiceAvailable: true,
        lines: [
          {
            id: "shirt-buyer-0",
            name: "Event shirt",
            category: "merch",
            quantity: 2,
            unitPrice: "21.25",
            currency: "USD",
            units: [],
          },
        ],
      },
    ])
  })

  it("projects buyer-owned ownerless parking units", () => {
    const payments = [
      {
        id: "parking-payment",
        products_snapshot: [
          {
            units: [
              {
                id: "parking-unit",
                check_in_code: "PARK1234",
                active: true,
                requires_check_in: true,
              },
              {
                id: "revoked-parking-unit",
                check_in_code: "REVOKED1",
                active: false,
                requires_check_in: true,
              },
            ],
          },
        ],
      },
    ] as PaymentPublic[]

    expect(projectOrders(payments, false)[0]?.lines[0]?.units).toEqual([
      { id: "parking-unit", checkInCode: "PARK1234" },
    ])
  })

  it("preserves unknown status and missing flow provenance as visible legacy history", () => {
    const orders = projectOrders(
      [
        {
          id: "legacy-payment",
          tenant_id: "tenant-1",
          popup_id: "popup-1",
          status: "provider_delayed",
          amount: "0.00",
          currency: "EUR",
          sales_flow_id: null,
          created_at: "2023-01-01T00:00:00Z",
          products_snapshot: [],
        } as PaymentPublic,
      ],
      false,
    )

    expect(orders).toEqual([
      {
        id: "legacy-payment",
        status: "unknown",
        provenance: "legacy",
        total: "0.00",
        currency: "EUR",
        createdAt: "2023-01-01T00:00:00Z",
        invoiceAvailable: false,
        lines: [],
      },
    ])
  })

  it("sorts valid creation dates newest first while keeping invalid and missing dates stably last", () => {
    const orders = projectOrders(
      [
        {
          id: "oldest",
          status: "approved",
          amount: "10.00",
          currency: "USD",
          sales_flow_id: "flow-1",
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "invalid-first",
          status: "approved",
          amount: "10.00",
          currency: "USD",
          sales_flow_id: "flow-1",
          created_at: "not-a-date",
        },
        {
          id: "newest",
          status: "approved",
          amount: "10.00",
          currency: "USD",
          sales_flow_id: "flow-1",
          created_at: "2026-08-21T12:00:00Z",
        },
        {
          id: "same-time-first",
          status: "approved",
          amount: "10.00",
          currency: "USD",
          sales_flow_id: "flow-1",
          created_at: "2026-03-01T00:00:00Z",
        },
        {
          id: "missing",
          status: "approved",
          amount: "10.00",
          currency: "USD",
          sales_flow_id: "flow-1",
          created_at: null,
        },
        {
          id: "same-time-second",
          status: "approved",
          amount: "10.00",
          currency: "USD",
          sales_flow_id: "flow-1",
          created_at: "2026-03-01T00:00:00Z",
        },
        {
          id: "invalid-second",
          status: "approved",
          amount: "10.00",
          currency: "USD",
          sales_flow_id: "flow-1",
          created_at: "also-not-a-date",
        },
      ] as PaymentPublic[],
      false,
    )

    expect(orders.map((order) => order.id)).toEqual([
      "newest",
      "same-time-first",
      "same-time-second",
      "oldest",
      "invalid-first",
      "missing",
      "invalid-second",
    ])
  })
})
