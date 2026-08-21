import { describe, expect, it } from "vitest"
import { purchasesFromPayments } from "./useGetPurchases"

describe("purchasesFromPayments", () => {
  it("keeps a direct purchase attached to its real attendee", () => {
    const purchases = purchasesFromPayments(
      [
        {
          products_snapshot: [
            {
              attendee_id: "attendee-1",
              product_id: "product-1",
              product_name: "Weekend pass",
              product_price: "99.00",
              product_category: "ticket",
              product_currency: "USD",
              quantity: 1,
              created_at: "2026-08-21T00:00:00Z",
            },
          ],
        },
      ],
      [
        {
          id: "attendee-1",
          name: "Taylor Buyer",
          category: "main",
        },
      ],
    )

    expect(purchases).toEqual([
      {
        attendee_id: "attendee-1",
        attendee_name: "Taylor Buyer",
        attendee_category: "main",
        products: [
          expect.objectContaining({
            id: "product-1",
            name: "Weekend pass",
            price: "99.00",
            quantity: 1,
          }),
        ],
      },
    ])
  })

  it("does not invent a synthetic attendee for unknown payment snapshots", () => {
    expect(
      purchasesFromPayments(
        [
          {
            products_snapshot: [
              {
                attendee_id: "unknown-attendee",
                product_id: "product-1",
                product_name: "Weekend pass",
                product_price: "99.00",
                product_category: "ticket",
                product_currency: "USD",
                quantity: 1,
                created_at: "2026-08-21T00:00:00Z",
              },
            ],
          },
        ],
        [],
      ),
    ).toEqual([])
  })
})
