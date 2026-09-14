import { describe, expect, it } from "vitest"
import type { PaymentPublic } from "@/client"
import { projectOtherPurchasedProducts } from "./otherProductsProjection"

const payment = (overrides: Partial<PaymentPublic> = {}): PaymentPublic => ({
  id: "payment-1",
  tenant_id: "tenant-1",
  popup_id: "popup-1",
  status: "approved",
  sales_flow_id: "direct-flow",
  products_snapshot: [],
  ...overrides,
})

const product = (
  productId: string,
  units?: Array<{
    id: string
    attendee_id?: string | null
    check_in_code: string
    active: boolean
    requires_check_in: boolean
  }>,
) => ({
  product_id: productId,
  attendee_id: null,
  product_name: productId === "shirt" ? "Event shirt" : "Weekend pass",
  product_price: "25",
  product_category: productId === "shirt" ? "merch" : "ticket",
  product_currency: "USD",
  quantity: units?.length ?? 1,
  units,
  created_at: "2026-09-11T12:00:00Z",
})

describe("projectOtherPurchasedProducts", () => {
  it("keeps approved non-application products not already visible as passes", () => {
    const result = projectOtherPurchasedProducts(
      [
        payment({
          products_snapshot: [
            product("weekend-pass", [
              {
                id: "visible-ticket",
                check_in_code: "ticket-code",
                active: true,
                requires_check_in: true,
              },
            ]),
            product("shirt", [
              {
                id: "ownerless-shirt",
                check_in_code: "shirt-code",
                active: true,
                requires_check_in: false,
              },
            ]),
          ],
        }),
      ],
      new Set(),
      [
        {
          id: "visible-ticket",
          paymentId: "payment-1",
          productId: "weekend-pass",
        },
      ],
    )

    expect(result).toEqual([{ id: "shirt", name: "Event shirt", quantity: 1 }])
  })

  it("excludes application, unapproved, and unattributed payments", () => {
    const result = projectOtherPurchasedProducts(
      [
        payment({
          id: "application-payment",
          application_id: "application-1",
          sales_flow_id: "application-flow",
          products_snapshot: [product("shirt")],
        }),
        payment({
          id: "known-application-flow",
          sales_flow_id: "application-flow",
          products_snapshot: [product("shirt")],
        }),
        payment({
          id: "pending-payment",
          status: "pending",
          products_snapshot: [product("shirt")],
        }),
        payment({
          id: "legacy-payment",
          sales_flow_id: null,
          products_snapshot: [product("shirt")],
        }),
      ],
      new Set(["application-flow"]),
      [],
    )

    expect(result).toEqual([])
  })

  it("aggregates active quantities across payments", () => {
    const result = projectOtherPurchasedProducts(
      [
        payment({
          id: "payment-1",
          products_snapshot: [product("shirt")],
        }),
        payment({
          id: "payment-2",
          products_snapshot: [
            product("shirt", [
              {
                id: "shirt-1",
                check_in_code: "code-1",
                active: true,
                requires_check_in: false,
              },
              {
                id: "shirt-2",
                check_in_code: "code-2",
                active: false,
                requires_check_in: false,
              },
            ]),
          ],
        }),
      ],
      new Set(),
      [],
    )

    expect(result).toEqual([{ id: "shirt", name: "Event shirt", quantity: 2 }])
  })

  it("falls back to snapshot quantities when operational units are unavailable", () => {
    const result = projectOtherPurchasedProducts(
      [
        payment({
          products_snapshot: [
            {
              ...product("shirt"),
              quantity: 2,
              units: [],
            },
          ],
        }),
      ],
      new Set(),
      [
        {
          id: "legacy-visible-shirt",
          paymentId: "payment-1",
          productId: "shirt",
        },
      ],
    )

    expect(result).toEqual([{ id: "shirt", name: "Event shirt", quantity: 1 }])
  })
})
