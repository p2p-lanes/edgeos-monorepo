import { render, screen } from "@testing-library/react"
import OpenTicketingCheckoutPage from "./page"

const mockUseCheckoutRuntime = vi.fn()

vi.mock("next/navigation", () => ({
  useParams: () => ({ popupSlug: "festival-2026" }),
}))

vi.mock("./hooks/useCheckoutRuntime", () => ({
  useCheckoutRuntime: () => mockUseCheckoutRuntime(),
}))

vi.mock("@/components/checkout-flow/OpenCheckoutRuntime", () => ({
  OpenCheckoutRuntime: ({ popupSlug }: { popupSlug: string }) => (
    <div>runtime:{popupSlug}</div>
  ),
}))

const runtimeData = {
  popup: {
    id: "popup-1",
    slug: "festival-2026",
    name: "Festival 2026",
  },
  products: [],
  buyer_form: [],
  ticketing_steps: [],
}

describe("OpenTicketingCheckoutPage", () => {
  beforeEach(() => {
    mockUseCheckoutRuntime.mockReturnValue({
      data: runtimeData,
      isLoading: false,
      isError: false,
    })
  })

  it("renders loading state while runtime is pending", () => {
    mockUseCheckoutRuntime.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    })

    render(<OpenTicketingCheckoutPage />)

    expect(screen.getByText("Cargando checkout...")).toBeTruthy()
  })

  it("renders unavailable state when runtime loading fails", () => {
    mockUseCheckoutRuntime.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    })

    render(<OpenTicketingCheckoutPage />)

    expect(screen.getByText("Checkout no disponible")).toBeTruthy()
  })

  it("renders the shared runtime for the popup slug", () => {
    render(<OpenTicketingCheckoutPage />)

    expect(screen.getByText("runtime:festival-2026")).toBeTruthy()
  })
})
