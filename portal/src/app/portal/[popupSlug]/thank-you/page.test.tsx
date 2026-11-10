import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import PortalThankYouPage from "./page"

const confirmPayment = vi.hoisted(() => vi.fn())
vi.mock("@/client", () => ({
  PaymentsService: { confirmMyPayment: confirmPayment },
}))

const mockPush = vi.fn()
const mockUseCheckoutRuntime = vi.fn()
let mockSearchParams = new URLSearchParams()

vi.mock("next/navigation", () => ({
  useParams: () => ({ popupSlug: "summer-camp" }),
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}))

vi.mock("@/providers/tenantProvider", () => ({
  useTenant: () => ({ tenant: { landing_mode: "portal" } }),
}))

vi.mock("@/app/checkout/[popupSlug]/hooks/useCheckoutRuntime", () => ({
  useCheckoutRuntime: (...args: unknown[]) => mockUseCheckoutRuntime(...args),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "portalThankYou.title": "Purchase completed",
        "portalThankYou.description":
          "Your purchase is complete. Your passes are ready in the portal.",
        "portalThankYou.passes_cta": "View my passes",
      })[key] ?? key,
  }),
}))

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <PortalThankYouPage />
    </QueryClientProvider>,
  )
}

describe("PortalThankYouPage", () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockSearchParams = new URLSearchParams({
      payment_id: "11111111-1111-4111-8111-111111111111",
    })
    confirmPayment.mockReset().mockResolvedValue({ status: "approved" })
    mockUseCheckoutRuntime.mockReset()
    mockUseCheckoutRuntime.mockReturnValue({ data: undefined })
  })

  it("confirms completion and links to the popup passes", async () => {
    renderPage()
    await screen.findByRole("heading", { name: "Purchase completed" })

    expect(
      screen.getByRole("heading", { name: "Purchase completed" }),
    ).toBeTruthy()
    expect(
      screen.getByText(
        "Your purchase is complete. Your passes are ready in the portal.",
      ),
    ).toBeTruthy()
    screen.getByRole("button", { name: /View my passes/ }).click()
    expect(mockPush).toHaveBeenCalledWith("/portal/summer-camp/passes")
    expect(mockUseCheckoutRuntime).toHaveBeenCalledWith("summer-camp", {
      flowSlug: "checkout",
    })
  })

  it("renders flow-owned config and the backend order item shape", async () => {
    mockSearchParams = new URLSearchParams({
      flow: "experiences",
      payment_id: "11111111-1111-4111-8111-111111111111",
    })
    mockSearchParams.set(
      "data",
      btoa(
        JSON.stringify({
          first_name: "Taylor",
          amount_total: "270.00",
          currency: "USD",
          items: [{ title: "Bay Networking Cruise", qty: 2, price: 135 }],
        }),
      ),
    )
    mockUseCheckoutRuntime.mockReturnValue({
      data: {
        popup: {},
        theme_config: {
          thank_you: {
            title: "Welcome, {first_name}",
            description: "Your experience is confirmed.",
            show_order_summary: true,
            cta: { label: "View your passes" },
          },
        },
      },
    })

    renderPage()
    await screen.findByText("Welcome, Taylor")

    expect(mockUseCheckoutRuntime).toHaveBeenCalledWith("summer-camp", {
      flowSlug: "experiences",
    })
    expect(screen.getByText("Welcome, Taylor")).toBeTruthy()
    expect(screen.getByText("Bay Networking Cruise")).toBeTruthy()
    expect(screen.getByText("×2")).toBeTruthy()
    expect(screen.getByText("270.00 USD")).toBeTruthy()
    screen.getByRole("button", { name: /View your passes/ }).click()
    expect(mockPush).toHaveBeenCalledWith("/portal/summer-camp/passes")
  })

  it("normalizes legacy order item names and quantities", () => {
    mockSearchParams.set(
      "data",
      btoa(
        JSON.stringify({
          items: [{ name: "Legacy pass", quantity: 3 }],
        }),
      ),
    )
    mockUseCheckoutRuntime.mockReturnValue({
      data: {
        popup: {},
        theme_config: { thank_you: { show_order_summary: true } },
      },
    })

    renderPage()

    expect(screen.getByText("Legacy pass")).toBeTruthy()
    expect(screen.getByText("×3")).toBeTruthy()
  })
})

describe("verified Portal return", () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockSearchParams = new URLSearchParams({
      payment_id: "11111111-1111-4111-8111-111111111111",
    })
    mockUseCheckoutRuntime.mockReturnValue({ data: undefined })
    confirmPayment.mockReset()
  })
  it("does not claim success or navigate until provider confirmation", async () => {
    let resolve!: (result: { status: string }) => void
    confirmPayment.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    renderPage()
    expect(
      screen.queryByRole("heading", { name: "Purchase completed" }),
    ).toBeNull()
    await act(async () => resolve({ status: "approved" }))
    expect(
      await screen.findByRole("heading", { name: "Purchase completed" }),
    ).toBeTruthy()
    expect(confirmPayment).toHaveBeenCalledWith({
      paymentId: "11111111-1111-4111-8111-111111111111",
    })
    expect(mockPush).not.toHaveBeenCalled()
  })
  it("keeps pending payments on thank-you without a false success", async () => {
    confirmPayment.mockResolvedValue({ status: "pending" })
    renderPage()
    await waitFor(() => expect(confirmPayment).toHaveBeenCalled())
    expect(
      screen.queryByRole("heading", { name: "Purchase completed" }),
    ).toBeNull()
    expect(mockPush).not.toHaveBeenCalled()
  })
  it("does not trust an unsigned order snapshot or missing payment id", () => {
    mockSearchParams = new URLSearchParams({
      data: btoa(JSON.stringify({ order_id: "forged" })),
    })
    renderPage()
    expect(confirmPayment).not.toHaveBeenCalled()
    expect(
      screen.queryByRole("heading", { name: "Purchase completed" }),
    ).toBeNull()
  })
})

it("allows an explicit retry after confirmation is unavailable", async () => {
  mockPush.mockReset()
  mockSearchParams = new URLSearchParams({
    payment_id: "11111111-1111-4111-8111-111111111111",
  })
  confirmPayment
    .mockReset()
    .mockRejectedValueOnce(new Error("unavailable"))
    .mockResolvedValue({ status: "approved" })
  renderPage()
  const retry = await screen.findByRole("button", {
    name: "portalThankYou.retry",
  })
  expect(
    screen.queryByRole("heading", { name: "Purchase completed" }),
  ).toBeNull()
  retry.click()
  await screen.findByRole("heading", { name: "Purchase completed" })
  expect(mockPush).not.toHaveBeenCalled()
  expect(confirmPayment).toHaveBeenCalledTimes(2)
})
