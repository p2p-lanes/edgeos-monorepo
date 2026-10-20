import { describe, expect, it } from "vitest"
import type { PaymentPortalPublic } from "@/client"
import { projectOtherPurchasedProducts } from "./otherProductsProjection"

const payment = (
  overrides: Partial<PaymentPortalPublic> = {},
): PaymentPortalPublic => ({
  id: "payment-1",
  tenant_id: "tenant-1",
  popup_id: "popup-1",
  status: "approved",
  sales_flow_id: "direct-flow",
  products_snapshot: [],
  ...overrides,
})

type Unit = {
  id: string
  attendee_id?: string | null
  check_in_code: string
  active: boolean
  requires_check_in: boolean
  last_scan_at?: string | null
}

const unit = (id: string, overrides: Partial<Unit> = {}): Unit => ({
  id,
  check_in_code: `code-${id}`,
  active: true,
  requires_check_in: true,
  ...overrides,
})

const product = (productId: string, units?: Unit[]) => ({
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

const shirtRow = {
  paymentId: "payment-1",
  id: "shirt",
  name: "Event shirt",
  category: "merch",
  salesFlowId: "direct-flow",
}

describe("projectOtherPurchasedProducts", () => {
  it("keeps approved non-application products not already visible as passes", () => {
    const result = projectOtherPurchasedProducts(
      [
        payment({
          products_snapshot: [
            product("weekend-pass", [unit("visible-ticket")]),
            product("shirt", [
              unit("ownerless-shirt", { requires_check_in: false }),
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

    expect(result).toEqual([
      {
        ...shirtRow,
        key: "ownerless-shirt",
        checkInCode: null,
        lastScanAt: null,
        number: 1,
        total: 1,
      },
    ])
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

  it("gives every active unit its own numbered row, across payments", () => {
    const result = projectOtherPurchasedProducts(
      [
        payment({
          id: "payment-1",
          products_snapshot: [
            product("shirt", [
              unit("a"),
              unit("revoked", { active: false }),
              unit("not-scannable", { requires_check_in: false }),
              unit("no-code", { check_in_code: "" }),
            ]),
          ],
        }),
        payment({
          id: "payment-2",
          products_snapshot: [product("shirt", [unit("b")])],
        }),
      ],
      new Set(),
      [],
    )

    expect(
      result.map(({ key, checkInCode, number, total }) => ({
        key,
        checkInCode,
        number,
        total,
      })),
    ).toEqual([
      { key: "a", checkInCode: "code-a", number: 1, total: 4 },
      { key: "not-scannable", checkInCode: null, number: 2, total: 4 },
      { key: "no-code", checkInCode: null, number: 3, total: 4 },
      { key: "b", checkInCode: "code-b", number: 4, total: 4 },
    ])
  })

  it("moves used QRs to the end and keeps their scan time", () => {
    const result = projectOtherPurchasedProducts(
      [
        payment({
          products_snapshot: [
            product("shirt", [
              unit("picked-up", { last_scan_at: "2026-10-12T15:00:00Z" }),
              unit("waiting"),
            ]),
          ],
        }),
      ],
      new Set(),
      [],
    )

    expect(
      result.map(({ key, number, lastScanAt }) => ({
        key,
        number,
        lastScanAt,
      })),
    ).toEqual([
      { key: "waiting", number: 2, lastScanAt: null },
      { key: "picked-up", number: 1, lastScanAt: "2026-10-12T15:00:00Z" },
    ])
  })

  it("splits legacy lines without units into one row per quantity", () => {
    const result = projectOtherPurchasedProducts(
      [
        payment({
          products_snapshot: [{ ...product("shirt"), quantity: 3, units: [] }],
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

    expect(result).toEqual([
      {
        ...shirtRow,
        key: "payment-1:shirt:0",
        checkInCode: null,
        lastScanAt: null,
        number: 1,
        total: 2,
      },
      {
        ...shirtRow,
        key: "payment-1:shirt:1",
        checkInCode: null,
        lastScanAt: null,
        number: 2,
        total: 2,
      },
    ])
  })
})
