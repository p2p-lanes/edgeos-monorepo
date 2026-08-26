import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { PaymentPublic } from "@/client"
import { OrdersContent } from "./OrdersContent"

const translate = (key: string) =>
  (
    ({
      "orders.title": "Orders",
      "orders.description": "Your payment history for this event.",
      "orders.status.approved": "Approved",
      "orders.status.unknown": "Unknown payment status",
      "orders.legacy_purchase": "Legacy purchase",
      "orders.total": "Total",
      "orders.invoice": "Invoice",
      "orders.empty_title": "No orders yet",
      "orders.empty_description": "Your payment history will appear here.",
      "orders.line_quantity": "Quantity: {{count}}",
    }) as Record<string, string>
  )[key] ?? key

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}))

vi.mock("@/helpers/dates", () => ({
  formatDate: () => "August 21, 2026",
}))

describe("OrdersContent", () => {
  it("renders merchandise snapshots, the payment status, total, and invoice action", () => {
    render(
      <OrdersContent
        invoiceAvailable
        payments={[
          {
            id: "payment-1",
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
                product_price: "21.25",
                product_category: "merch",
                product_currency: "USD",
                quantity: 2,
                created_at: "2026-08-21T12:00:00Z",
              },
            ],
          } as PaymentPublic,
        ]}
      />,
    )

    expect(screen.getByText("Event shirt")).toBeTruthy()
    expect(screen.getByText("Approved")).toBeTruthy()
    expect(screen.getByText("Total")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Invoice" })).toBeTruthy()
  })

  it("renders unknown legacy payments without a purchase action", () => {
    render(
      <OrdersContent
        invoiceAvailable={false}
        payments={[
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
        ]}
      />,
    )

    expect(screen.getByText("Unknown payment status")).toBeTruthy()
    expect(screen.getByText("Legacy purchase")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Invoice" })).toBeNull()
    expect(screen.queryByRole("link", { name: /shop|buy/i })).toBeNull()
  })

  it("keeps each order's status, purchase summary, total, and invoice action together in newest-first ledger rows", () => {
    render(
      <OrdersContent
        invoiceAvailable
        payments={
          [
            {
              id: "older-payment",
              tenant_id: "tenant-1",
              popup_id: "popup-1",
              status: "approved",
              amount: "15.00",
              currency: "USD",
              sales_flow_id: "merch-flow",
              created_at: "2026-01-01T12:00:00Z",
              products_snapshot: [
                {
                  product_id: "older-shirt",
                  attendee_id: "buyer",
                  product_name: "Older shirt",
                  product_price: "15.00",
                  product_category: "merch",
                  product_currency: "USD",
                  quantity: 1,
                  created_at: "2026-01-01T12:00:00Z",
                },
              ],
            },
            {
              id: "newer-payment",
              tenant_id: "tenant-1",
              popup_id: "popup-1",
              status: "approved",
              amount: "42.50",
              currency: "USD",
              sales_flow_id: "merch-flow",
              created_at: "2026-08-21T12:00:00Z",
              products_snapshot: [
                {
                  product_id: "newer-shirt",
                  attendee_id: "buyer",
                  product_name: "Newer shirt",
                  product_price: "42.50",
                  product_category: "merch",
                  product_currency: "USD",
                  quantity: 1,
                  created_at: "2026-08-21T12:00:00Z",
                },
              ],
            },
          ] as PaymentPublic[]
        }
      />,
    )

    const ledgerRows = screen.getAllByRole("article")

    expect(ledgerRows).toHaveLength(2)
    expect(within(ledgerRows[0]).getByText("Newer shirt")).toBeTruthy()
    expect(within(ledgerRows[0]).getByText("Approved")).toBeTruthy()
    expect(within(ledgerRows[0]).getByText("Total")).toBeTruthy()
    expect(
      within(ledgerRows[0]).getByRole("button", { name: "Invoice" }),
    ).toBeTruthy()
    expect(within(ledgerRows[1]).getByText("Older shirt")).toBeTruthy()
  })
})
