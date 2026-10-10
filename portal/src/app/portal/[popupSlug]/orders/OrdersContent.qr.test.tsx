import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PaymentPortalPublic } from "@/client"
import en from "@/i18n/locales/en.json"
import QRcode from "../passes/components/common/QRcode"
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

// Exercise the real shared dialog and verify the exact scanner payload.
vi.mock("react-qr-code", () => ({
  default: ({ value }: { value: string }) => (
    <div data-testid="qr-payload">{value}</div>
  ),
}))

vi.mock("@/lib/qr-download", () => ({
  downloadQrPng: vi.fn(async () => {}),
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

describe("OrdersContent product QR", () => {
  it("opens one QR per merchandise unit without requiring a participant", () => {
    render(orders([payment()]))

    const buttons = screen.getAllByRole("button", { name: /View QR for/ })
    expect(buttons).toHaveLength(2)
    expect(buttons[0].textContent).toContain("View QR 1")
    expect(buttons[1].textContent).toContain("View QR 2")
    expect(screen.queryByRole("dialog")).toBeNull()

    fireEvent.click(buttons[1])

    const dialog = screen.getByRole("dialog", {
      name: "Conference T-Shirt · QR 2",
    })
    expect(within(dialog).getByText("SHIRT2")).toBeTruthy()
    expect(within(dialog).getByTestId("qr-payload").textContent).toBe(
      JSON.stringify({ code: "SHIRT2" }),
    )
    expect(
      within(dialog).getByText("Show this QR to the operator for this item."),
    ).toBeTruthy()
    expect(within(dialog).queryByText("Use this code to check in")).toBeNull()

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    fireEvent.click(buttons[0])
    expect(screen.getByTestId("qr-payload").textContent).toBe(
      JSON.stringify({ code: "SHIRT1" }),
    )
  })

  it("keeps codes scoped to their order when the same product was purchased twice", () => {
    const second = payment({ id: "second-payment" })
    second.products_snapshot![0].units![0].id = "second-unit-1"
    second.products_snapshot![0].units![0].check_in_code = "SECOND1"
    second.products_snapshot![0].units![1].id = "second-unit-2"
    second.products_snapshot![0].units![1].check_in_code = "SECOND2"
    render(orders([payment(), second]))

    const secondOrder = screen.getAllByRole("article")[1]
    fireEvent.click(
      within(secondOrder).getByRole("button", {
        name: "View QR for Conference T-Shirt, unit 1",
      }),
    )

    expect(screen.getByTestId("qr-payload").textContent).toBe(
      JSON.stringify({ code: "SECOND1" }),
    )
    expect(screen.queryByText("SHIRT1")).toBeNull()
  })

  it("preserves the product, quantity, and price when no units are available", () => {
    const purchase = payment()
    purchase.products_snapshot![0].units = []
    render(orders([purchase]))

    expect(screen.getByText("Conference T-Shirt")).toBeTruthy()
    expect(screen.getByText(/Quantity: 2/)).toBeTruthy()
    expect(screen.getByText("$35")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /View QR for/ })).toBeNull()
  })

  it.each([
    "pending",
    "cancelled",
    "expired",
    "rejected",
    "unknown",
  ])("does not offer a QR for a %s payment", (status) => {
    render(orders([payment({ status })]))
    expect(screen.getByText("Conference T-Shirt")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /View QR for/ })).toBeNull()
  })

  it.each([
    "revoked",
    "non-scannable",
    "cancelled",
  ])("closes an open QR when the unit becomes %s on refresh", (reason) => {
    const view = render(orders([payment()]))
    fireEvent.click(
      screen.getByRole("button", {
        name: "View QR for Conference T-Shirt, unit 2",
      }),
    )
    expect(screen.getByText("SHIRT2")).toBeTruthy()

    const updated = payment()
    const unit = updated.products_snapshot![0].units![1]
    if (reason === "revoked") unit.active = false
    if (reason === "non-scannable") unit.requires_check_in = false
    if (reason === "cancelled") updated.status = "cancelled"
    view.rerender(orders([updated]))

    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByText("SHIRT2")).toBeNull()
  })

  it("removes the open QR when the purchase is no longer visible", () => {
    const view = render(orders([payment()]))
    fireEvent.click(
      screen.getByRole("button", {
        name: "View QR for Conference T-Shirt, unit 1",
      }),
    )

    view.rerender(orders([]))

    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByText("SHIRT1")).toBeNull()
    expect(screen.getByText("No payments yet")).toBeTruthy()
  })

  it("leaves the shared participant QR's existing text unchanged", () => {
    render(<QRcode check_in_code="TICKET1" isOpen onOpenChange={() => {}} />)

    expect(screen.getByRole("dialog", { name: "Check-in Code" })).toBeTruthy()
    expect(screen.getByText("Use this code to check in")).toBeTruthy()
    expect(screen.getByTestId("qr-payload").textContent).toBe(
      JSON.stringify({ code: "TICKET1" }),
    )
  })
})
