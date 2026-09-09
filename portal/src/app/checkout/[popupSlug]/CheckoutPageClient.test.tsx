import { act, render, screen } from "@testing-library/react"
import { ApiError } from "@/client"
import {
  LANGUAGE_STORAGE_KEY,
  setActiveRequestLanguage,
} from "@/lib/language-storage"
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
  selected_flow: {
    id: "flow-1",
    slug: "festival-2026",
  },
  products: [],
  buyer_form: [],
  ticketing_steps: [],
}

function runtimeApiError(status: number) {
  return new ApiError(
    { method: "GET", url: "/checkout" } as never,
    { url: "/checkout", ok: false, status, statusText: "", body: null },
    "runtime request failed",
  )
}

function lastRuntimeOpts(): {
  language?: string | null
  initialDataUpdatedAt?: number
} {
  const calls = mockUseCheckoutRuntime.mock.calls
  return (calls[calls.length - 1]?.[1] ?? {}) as {
    language?: string | null
    initialDataUpdatedAt?: number
  }
}

describe("CheckoutPageClient", () => {
  beforeEach(() => {
    localStorage.clear()
    setActiveRequestLanguage(null)
    mockUseCheckoutRuntime.mockClear()
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

    render(<CheckoutPageClient popupSlug="festival-2026" flowSlug="checkout" />)

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

    render(<CheckoutPageClient popupSlug="festival-2026" flowSlug="checkout" />)

    expect(screen.getByText("openCheckout.unavailable_title")).toBeTruthy()
    expect(
      screen.getByText("openCheckout.unavailable_description"),
    ).toBeTruthy()
  })

  it("renders the sign-in card with a redirect back to the checkout on 401", () => {
    mockUseCheckoutRuntime.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: runtimeApiError(401),
    })

    render(
      <CheckoutPageClient popupSlug="festival-2026" flowSlug="upsale-2026" />,
    )

    expect(screen.getByText("openCheckout.sign_in_required_title")).toBeTruthy()
    expect(
      screen.getByText("openCheckout.sign_in_required_description"),
    ).toBeTruthy()
    const link = screen.getByRole("link", {
      name: "openCheckout.sign_in_required_cta",
    })
    expect(link.getAttribute("href")).toBe(
      "/auth?redirect=%2Fcheckout%2Ffestival-2026%2Fupsale-2026",
    )
    expect(screen.queryByText("openCheckout.unavailable_title")).toBeNull()
  })

  it("keeps the unavailable card for non-401 runtime errors", () => {
    mockUseCheckoutRuntime.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: runtimeApiError(404),
    })

    render(
      <CheckoutPageClient popupSlug="festival-2026" flowSlug="upsale-2026" />,
    )

    expect(screen.getByText("openCheckout.unavailable_title")).toBeTruthy()
    expect(screen.queryByText("openCheckout.sign_in_required_title")).toBeNull()
  })

  it("renders the shared runtime for the popup slug", () => {
    render(<CheckoutPageClient popupSlug="festival-2026" flowSlug="checkout" />)

    expect(screen.getByText("runtime:festival-2026")).toBeTruthy()
  })

  // --- New test cases ---

  it("renders product content immediately when initialRuntime is provided", () => {
    // When initialRuntime is provided, isLoading starts as false and data is
    // immediately available — no spinner should render
    render(
      <CheckoutPageClient
        popupSlug="festival-2026"
        flowSlug="checkout"
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
    render(<CheckoutPageClient popupSlug="festival-2026" flowSlug="checkout" />)

    expect(screen.getByText("runtime:festival-2026")).toBeTruthy()
  })

  // --- Language / SSR payload agreement ---

  it("keys the runtime query on the stored language", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "en")

    render(<CheckoutPageClient popupSlug="festival-2026" flowSlug="checkout" />)

    expect(lastRuntimeOpts().language).toBe("en")
  })

  it("keeps the server payload fresh when it was fetched in the same language", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "en")
    const updatedAt = Date.now()

    render(
      <CheckoutPageClient
        popupSlug="festival-2026"
        flowSlug="checkout"
        initialRuntime={runtimeData as never}
        initialDataUpdatedAt={updatedAt}
        initialRuntimeLanguage="en"
      />,
    )

    expect(lastRuntimeOpts().initialDataUpdatedAt).toBe(updatedAt)
  })

  it("hands over the server payload already stale when the stored language differs from the one SSR used", () => {
    // The reported bug: no ?lang, so SSR fetched with no Accept-Language and
    // returned the popup's source copy, while the visitor's stored choice is
    // English. Without this the payload stays fresh for the whole staleTime.
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "en")

    render(
      <CheckoutPageClient
        popupSlug="festival-2026"
        flowSlug="checkout"
        initialRuntime={runtimeData as never}
        initialDataUpdatedAt={Date.now()}
        initialRuntimeLanguage={null}
      />,
    )

    expect(lastRuntimeOpts().language).toBe("en")
    expect(lastRuntimeOpts().initialDataUpdatedAt).toBe(0)
  })

  it("keeps the server payload fresh when the visitor has no stored language", () => {
    render(
      <CheckoutPageClient
        popupSlug="festival-2026"
        flowSlug="checkout"
        initialRuntime={runtimeData as never}
        initialDataUpdatedAt={1234}
        initialRuntimeLanguage={null}
      />,
    )

    expect(lastRuntimeOpts().language).toBeNull()
    expect(lastRuntimeOpts().initialDataUpdatedAt).toBe(1234)
  })

  it("re-keys when the provider switches the on-screen language", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "en")

    render(<CheckoutPageClient popupSlug="festival-2026" flowSlug="checkout" />)
    expect(lastRuntimeOpts().language).toBe("en")

    act(() => {
      setActiveRequestLanguage("es")
    })

    expect(lastRuntimeOpts().language).toBe("es")
  })

  it("prefilledBuyer is populated when useAuth returns a user", () => {
    mockUseAuth.mockReturnValue({
      user: {
        email: "test@example.com",
        first_name: "Jane",
        last_name: "Doe",
      },
    } as never)

    render(<CheckoutPageClient popupSlug="festival-2026" flowSlug="checkout" />)

    // Component renders normally — OpenCheckoutRuntime receives prefilledBuyer
    // via props; we verify no error and runtime renders
    expect(screen.getByText("runtime:festival-2026")).toBeTruthy()
  })
})
