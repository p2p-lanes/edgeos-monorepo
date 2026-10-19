import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PaymentsService } from "@/client"
import en from "@/i18n/locales/en.json"
import type { OtherPurchasedProduct } from "../otherProductsProjection"
import { OtherPurchasedProducts } from "./OtherPurchasedProducts"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options: Record<string, unknown> = {}) => {
      const [namespace, name] = key.split(".") as ["orders" | "passes", string]
      const label = (en[namespace] as unknown as Record<string, string>)[name]
      return String(label ?? key).replace(/{{(\w+)}}/g, (_, option) =>
        String(options[option] ?? ""),
      )
    },
    i18n: { language: "en" },
  }),
}))

vi.mock("@/components/payments/PaymentFormResponses", () => ({
  PaymentFormResponses: ({ paymentId }: { paymentId: string }) => (
    <div data-testid="response-payment">{paymentId}</div>
  ),
}))

vi.mock("@/client", () => ({
  PaymentsService: { getMyFormResponses: vi.fn() },
  TicketingStepsService: {
    listPortalTicketingSteps: vi.fn(async () => ({ results: [] })),
  },
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

const shirt = (
  overrides: Partial<OtherPurchasedProduct> = {},
): OtherPurchasedProduct => ({
  key: "unit-1",
  id: "shirt",
  name: "Conference T-Shirt",
  category: "merch",
  salesFlowId: "merch-flow",
  checkInCode: "SHIRT1",
  lastScanAt: null,
  number: 1,
  total: 2,
  ...overrides,
})

const twoShirts = [
  shirt(),
  shirt({ key: "unit-2", checkInCode: "SHIRT2", number: 2 }),
]

function renderProducts(products: OtherPurchasedProduct[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return render(
    <OtherPurchasedProducts
      products={products}
      paymentsHref="/portal/demo/orders"
    />,
    { wrapper },
  )
}

beforeEach(() => {
  vi.mocked(PaymentsService.getMyFormResponses).mockReset()
  vi.mocked(PaymentsService.getMyFormResponses).mockResolvedValue({
    fields: [],
  } as never)
})
afterEach(cleanup)

describe("OtherPurchasedProducts", () => {
  it("opens the answers of the selected order even when it has no QR", async () => {
    vi.mocked(PaymentsService.getMyFormResponses).mockResolvedValue({
      fields: [{ id: "field-1" }],
    } as never)
    renderProducts([
      shirt({
        key: "lunch-1",
        name: "Lunch Week 2",
        checkInCode: null,
        paymentId: "payment-1",
      }),
      shirt({
        key: "lunch-2",
        name: "Lunch Week 3",
        checkInCode: null,
        paymentId: "payment-2",
      }),
    ])
    fireEvent.click(
      await screen.findByRole("button", {
        name: "View purchase details for Lunch Week 3",
      }),
    )
    const dialog = screen.getByRole("dialog", { name: "Lunch Week 3" })
    expect(within(dialog).getByTestId("response-payment").textContent).toBe(
      "payment-2",
    )
    expect(screen.queryByTestId("qr-payload")).toBeNull()
  })

  it("keeps products with a payment but no form or QR non-interactive", async () => {
    renderProducts([
      shirt({
        name: "Lunch without form",
        checkInCode: null,
        paymentId: "payment-empty",
      }),
    ])
    await waitFor(() =>
      expect(PaymentsService.getMyFormResponses).toHaveBeenCalledWith({
        paymentId: "payment-empty",
      }),
    )
    expect(screen.getByText("Lunch without form")).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: /View purchase details/ }),
    ).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("does not offer empty details when form responses cannot be loaded", async () => {
    vi.mocked(PaymentsService.getMyFormResponses).mockRejectedValue(
      new Error("Unavailable"),
    )
    renderProducts([
      shirt({ checkInCode: null, paymentId: "payment-unavailable" }),
    ])
    await waitFor(() =>
      expect(PaymentsService.getMyFormResponses).toHaveBeenCalled(),
    )
    expect(
      screen.queryByRole("button", { name: /View purchase details/ }),
    ).toBeNull()
  })

  it("gives each unit its own row and opens that unit's QR", () => {
    renderProducts(twoShirts)

    const rows = screen.getAllByRole("listitem")
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText("1 of 2")).toBeTruthy()
    expect(within(rows[1]).getByText("2 of 2")).toBeTruthy()
    expect(screen.getAllByText("Ready to use")).toHaveLength(2)
    expect(screen.queryByText(/×/)).toBeNull()

    fireEvent.click(
      screen.getByRole("button", {
        name: "View QR for Conference T-Shirt, unit 2",
      }),
    )

    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("Conference T-Shirt · QR 2")).toBeTruthy()
    expect(within(dialog).getByTestId("qr-payload").textContent).toBe(
      JSON.stringify({ code: "SHIRT2" }),
    )
  })

  it("marks used units and warns when their QR is opened again", () => {
    renderProducts([
      shirt({
        total: 1,
        lastScanAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      }),
    ])

    expect(screen.getByText("Used")).toBeTruthy()
    expect(screen.getByText("2 hours ago")).toBeTruthy()
    expect(screen.queryByText("Ready to use")).toBeNull()
    expect(screen.queryByText(/of 1/)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /View QR for/ }))

    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("Conference T-Shirt")).toBeTruthy()
    expect(within(dialog).getByText(/QR already scanned/)).toBeTruthy()
  })

  it("shows products without a QR as plain rows", () => {
    renderProducts([shirt({ name: "testlunch", checkInCode: null, total: 1 })])

    expect(screen.getByText("testlunch")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /View QR for/ })).toBeNull()
    expect(screen.queryByText("Ready to use")).toBeNull()
  })

  it("closes the QR when its unit disappears on refetch", () => {
    const { rerender } = renderProducts(twoShirts)
    fireEvent.click(
      screen.getByRole("button", {
        name: "View QR for Conference T-Shirt, unit 1",
      }),
    )
    expect(screen.getByRole("dialog")).toBeTruthy()

    rerender(
      <OtherPurchasedProducts
        products={[twoShirts[1]]}
        paymentsHref="/portal/demo/orders"
      />,
    )

    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
