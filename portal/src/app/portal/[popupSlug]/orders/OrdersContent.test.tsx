import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OpenAPI, type PaymentPublic } from "@/client"
import { OrdersContent } from "./OrdersContent"

const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}))

const translate = (key: string, values?: { count?: number }) => {
  const translation =
    (
      {
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
        "orders.download_invoice_error": "Could not download your invoice.",
      } as Record<string, string>
    )[key] ?? key

  return translation.replace("{{count}}", String(values?.count))
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}))

vi.mock("@/helpers/dates", () => ({
  formatDate: (value: string) => `Date ${value}`,
}))

vi.mock("@/types/checkout", () => ({
  formatCurrency: (amount: number, currency: string) =>
    `${currency} ${amount.toFixed(2)}`,
}))

vi.mock("sonner", () => ({
  toast: { error: mockToastError },
}))

describe("OrdersContent", () => {
  const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
    window.URL,
    "createObjectURL",
  )
  const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
    window.URL,
    "revokeObjectURL",
  )

  beforeEach(() => {
    OpenAPI.BASE = ""
    OpenAPI.TOKEN = undefined
    localStorage.clear()
    mockToastError.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    if (originalCreateObjectUrl) {
      Object.defineProperty(
        window.URL,
        "createObjectURL",
        originalCreateObjectUrl,
      )
    } else {
      Reflect.deleteProperty(window.URL, "createObjectURL")
    }
    if (originalRevokeObjectUrl) {
      Object.defineProperty(
        window.URL,
        "revokeObjectURL",
        originalRevokeObjectUrl,
      )
    } else {
      Reflect.deleteProperty(window.URL, "revokeObjectURL")
    }
  })

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

  it("keeps every payment's status/date rail, snapshot lines, total, and invoice action in one divided ledger", () => {
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
                  product_price: "7.50",
                  product_category: "Merchandise",
                  product_currency: "USD",
                  quantity: 2,
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
                  product_price: "21.25",
                  product_category: "Merchandise",
                  product_currency: "USD",
                  quantity: 2,
                  created_at: "2026-08-21T12:00:00Z",
                },
              ],
            },
          ] as PaymentPublic[]
        }
      />,
    )

    const ledger = screen.getByTestId("orders-ledger")
    const ledgerRows = within(ledger).getAllByRole("article")

    expect(ledgerRows).toHaveLength(2)
    expect(within(ledgerRows[0]).getByText("Newer shirt")).toBeTruthy()
    expect(within(ledgerRows[0]).getByText("Approved")).toBeTruthy()
    expect(
      within(ledgerRows[0]).getByText("Date 2026-08-21T12:00:00Z"),
    ).toBeTruthy()
    expect(
      within(ledgerRows[0]).getByText("Quantity: 2 · Merchandise"),
    ).toBeTruthy()
    expect(within(ledgerRows[0]).getByText("USD 21.25")).toBeTruthy()
    expect(within(ledgerRows[0]).getByText("Total")).toBeTruthy()
    expect(within(ledgerRows[0]).getByText("USD 42.50")).toBeTruthy()
    expect(
      within(ledgerRows[0]).getByRole("button", { name: "Invoice" }),
    ).toBeTruthy()
    expect(within(ledgerRows[1]).getByText("Older shirt")).toBeTruthy()
    expect(
      within(ledgerRows[1]).getByText("Date 2026-01-01T12:00:00Z"),
    ).toBeTruthy()
    expect(
      within(ledgerRows[1]).getByText("Quantity: 2 · Merchandise"),
    ).toBeTruthy()
    expect(within(ledgerRows[1]).getByText("USD 7.50")).toBeTruthy()
    expect(within(ledgerRows[1]).getByText("USD 15.00")).toBeTruthy()
    expect(
      within(ledgerRows[1]).getByRole("button", { name: "Invoice" }),
    ).toBeTruthy()
  })

  it("downloads the selected payment invoice and restores its action after success", async () => {
    let resolveFetch: (response: Response) => void
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    const fetchMock = vi.fn(() => fetchPromise)
    const createObjectUrl = vi.fn(() => "blob:invoice-payment-1")
    const revokeObjectUrl = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    })
    Object.defineProperty(window.URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {})

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
            products_snapshot: [],
          } as PaymentPublic,
        ]}
      />,
    )

    const invoiceButton = screen.getByRole("button", {
      name: "Invoice",
    }) as HTMLButtonElement
    fireEvent.click(invoiceButton)

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/payments/my/payment-1/invoice",
      { headers: {} },
    )
    expect(invoiceButton.disabled).toBe(true)

    resolveFetch!(new Response("invoice", { status: 200 }))

    await waitFor(() => expect(invoiceButton.disabled).toBe(false))
    expect(createObjectUrl).toHaveBeenCalled()
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:invoice-payment-1")
    expect(click).toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("keeps the invoice action associated with its payment and reports download failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 500 }))
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubGlobal("fetch", fetchMock)

    render(
      <OrdersContent
        invoiceAvailable
        payments={[
          {
            id: "payment-failure",
            tenant_id: "tenant-1",
            popup_id: "popup-1",
            status: "approved",
            amount: "42.50",
            currency: "USD",
            sales_flow_id: "merch-flow",
            created_at: "2026-08-21T12:00:00Z",
            products_snapshot: [],
          } as PaymentPublic,
        ]}
      />,
    )

    const invoiceButton = screen.getByRole("button", {
      name: "Invoice",
    }) as HTMLButtonElement
    fireEvent.click(invoiceButton)

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        "Could not download your invoice.",
      ),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/payments/my/payment-failure/invoice",
      { headers: {} },
    )
    expect(invoiceButton.disabled).toBe(false)
    expect(consoleError).toHaveBeenCalled()
  })
})
