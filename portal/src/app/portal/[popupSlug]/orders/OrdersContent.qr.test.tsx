import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PaymentPortalPublic } from "@/client"
import en from "@/i18n/locales/en.json"
import { OrdersContent } from "./OrdersContent"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options: Record<string, unknown> = {}) => {
      const label =
        en.orders[key.replace("orders.", "") as keyof typeof en.orders]
      return String(label ?? key).replace(/{{(\w+)}}/g, (_, name) =>
        String(options[name] ?? ""),
      )
    },
    i18n: { language: "en" },
  }),
}))

const payment = (
  overrides: Partial<PaymentPortalPublic> = {},
): PaymentPortalPublic => ({
  id: "merch-payment",
  tenant_id: "tenant-1",
  popup_id: "popup-1",
  sales_flow_id: "merch-flow",
  application_id: null,
  status: "approved",
  amount: "70.00",
  currency: "USD",
  products_snapshot: [
    {
      product_id: "shirt",
      attendee_id: null,
      product_name: "Conference T-Shirt",
      product_price: "35.00",
      product_category: "merch",
      product_currency: "USD",
      quantity: 2,
      created_at: "2026-10-08T14:51:15Z",
      units: [
        {
          id: "unit-1",
          attendee_id: null,
          check_in_code: "SHIRT1",
          active: true,
          requires_check_in: true,
        },
        {
          id: "unit-2",
          attendee_id: null,
          check_in_code: "SHIRT2",
          active: true,
          requires_check_in: true,
        },
      ],
    },
  ],
  ...overrides,
})

const orders = (payments: PaymentPortalPublic[]) => (
  <OrdersContent payments={payments} invoiceAvailable={false} />
)

afterEach(cleanup)

vi.mock("@/components/payments/PaymentFormResponses", () => ({
  PaymentFormResponses: () => null,
}))

describe("OrdersContent", () => {
  it("shows payment details without QR actions even for scannable purchased units", () => {
    render(orders([payment()]))

    expect(screen.getByText("Conference T-Shirt")).toBeTruthy()
    expect(screen.getByText(/Quantity: 2/)).toBeTruthy()
    expect(screen.getByText("$35.00")).toBeTruthy()
    expect(screen.getByText("$70.00")).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByText("SHIRT1")).toBeNull()
    expect(screen.queryByText("SHIRT2")).toBeNull()
  })
})
