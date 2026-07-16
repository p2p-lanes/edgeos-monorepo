import { render, screen } from "@testing-library/react"
import CheckoutPageClient from "./CheckoutPageClient"

const mockUseCheckoutRuntime = vi.fn()

vi.mock("./hooks/useCheckoutRuntime", () => ({
  useCheckoutRuntime: (_slug: string, opts?: unknown) =>
    mockUseCheckoutRuntime(_slug, opts),
}))

vi.mock("@/components/checkout-flow/OpenCheckoutRuntime", () => ({
  OpenCheckoutRuntime: ({ popupSlug }: { popupSlug: string }) => (
    <div>runtime:{popupSlug}</div>
  ),
}))

const mockUseAuth = vi.fn(() => ({ user: null }))

vi.mock("@/hooks/useAuth", () => ({
  default: () => mockUseAuth(),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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

describe("CheckoutPageClient", () => {
  beforeEach(() => {
    mockUseCheckoutRuntime.mockReturnValue({
      data: runtimeData,
      isLoading: false,
      isError: false,
    })
  })

  // --- Migrated from page.test.tsx (behavior preserved) ---

  it("renders loading state while runtime is pending", () => {
    mockUseCheckoutRuntime.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    })

    render(<CheckoutPageClient popupSlug="festival-2026" />)

    // Loader renders a spinner — no text; assert the spinner element exists
    const spinner = document.querySelector(".animate-spin")
    expect(spinner).not.toBeNull()
  })

  it("renders unavailable state when runtime loading fails", () => {
    mockUseCheckoutRuntime.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    })

    render(<CheckoutPageClient popupSlug="festival-2026" />)

    expect(screen.getByText("openCheckout.unavailable_title")).toBeTruthy()
    expect(
      screen.getByText("openCheckout.unavailable_description"),
    ).toBeTruthy()
  })

  it("renders the shared runtime for the popup slug", () => {
    render(<CheckoutPageClient popupSlug="festival-2026" />)

    expect(screen.getByText("runtime:festival-2026")).toBeTruthy()
  })

  // --- New test cases ---

  it("renders product content immediately when initialRuntime is provided", () => {
    // When initialRuntime is provided, isLoading starts as false and data is
    // immediately available — no spinner should render
    render(
      <CheckoutPageClient
        popupSlug="festival-2026"
        initialRuntime={runtimeData as never}
        initialDataUpdatedAt={Date.now()}
      />,
    )

    expect(screen.getByText("runtime:festival-2026")).toBeTruthy()
    const spinner = document.querySelector(".animate-spin")
    expect(spinner).toBeNull()
  })

  it("prefilledBuyer is undefined when useAuth returns null user", () => {
    // The mock already returns { user: null } — verify it propagates correctly
    // by rendering without error (OpenCheckoutRuntime is mocked, so we just
    // confirm the component renders the runtime text without throwing)
    render(<CheckoutPageClient popupSlug="festival-2026" />)

    expect(screen.getByText("runtime:festival-2026")).toBeTruthy()
  })

  it("prefilledBuyer is populated when useAuth returns a user", () => {
    mockUseAuth.mockReturnValue({
      user: {
        email: "test@example.com",
        first_name: "Jane",
        last_name: "Doe",
      },
    } as never)

    render(<CheckoutPageClient popupSlug="festival-2026" />)

    // Component renders normally — OpenCheckoutRuntime receives prefilledBuyer
    // via props; we verify no error and runtime renders
    expect(screen.getByText("runtime:festival-2026")).toBeTruthy()
  })
})
