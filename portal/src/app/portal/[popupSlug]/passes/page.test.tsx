import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import HomePasses from "./page"

const mockPush = vi.fn()
const mockRefetch = vi.fn()

let mockAccess: { state: "loading" | "denied" | "allowed" }
let mockCity: {
  id: string
  sale_type: "direct" | "application"
  checkout_mode: "simple_quantity" | "pass_system"
}
let mockAttendeePasses: { id: string; products: unknown[] }[]
let mockProducts: { id: string }[]
let mockAttendeesQuery: {
  data?: unknown[]
  isLoading: boolean
  isError: boolean
  isFetching: boolean
  refetch: typeof mockRefetch
}

vi.mock("next/navigation", () => ({
  useParams: () => ({ popupSlug: "festival" }),
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/components/CompanionPasses", () => ({
  CompanionPasses: () => <div>companion-passes</div>,
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  ButtonAnimated: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}))

vi.mock("@/components/ui/Loader", () => ({
  Loader: () => <div data-testid="loader" />,
}))

vi.mock("@/hooks/useHumanAttendeesQuery", () => ({
  default: () => mockAttendeesQuery,
}))

vi.mock("@/hooks/useHumanPopupAccess", () => ({
  useHumanPopupAccess: () => mockAccess,
}))

vi.mock("@/hooks/useProductsQuery", () => ({
  useProductsQuery: () => ({ isLoading: false }),
}))

vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({ participation: null }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => mockCity,
  }),
}))

vi.mock("@/providers/passesProvider", () => ({
  usePassesProvider: () => ({
    attendeePasses: mockAttendeePasses,
    products: mockProducts,
  }),
}))

vi.mock("./Tabs/YourPasses", () => ({
  default: () => <div>your-passes</div>,
}))

describe("passes attendee query states", () => {
  beforeEach(() => {
    mockPush.mockReset()
    mockRefetch.mockReset()
    mockAccess = { state: "denied" }
    mockCity = {
      id: "popup-1",
      sale_type: "direct",
      checkout_mode: "simple_quantity",
    }
    mockAttendeePasses = [{ id: "human-1", products: [] }]
    mockProducts = [{ id: "product-1" }]
    mockAttendeesQuery = {
      data: [],
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: mockRefetch,
    }
  })

  it("keeps the checkout CTA after a successful empty attendee response", () => {
    render(<HomePasses />)

    fireEvent.click(screen.getByRole("button", { name: "cta.buy_tickets" }))

    expect(mockPush).toHaveBeenCalledWith("/checkout/festival")
  })

  it("renders a loader while direct-sale attendees are loading", () => {
    mockAttendeesQuery.isLoading = true

    render(<HomePasses />)

    expect(screen.getByTestId("loader")).toBeTruthy()
    expect(screen.queryByText("cta.buy_tickets")).toBeNull()
  })

  it("renders the retry state when the direct-sale attendee query fails", () => {
    mockAttendeesQuery.data = undefined
    mockAttendeesQuery.isError = true

    render(<HomePasses />)

    expect(screen.getByText("passes.error_title")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "passes.error_retry" }))
    expect(mockRefetch).toHaveBeenCalledOnce()
  })

  it("renders retained application passes after a background refetch error", () => {
    mockAccess = { state: "allowed" }
    mockCity = {
      id: "popup-1",
      sale_type: "application",
      checkout_mode: "pass_system",
    }
    mockAttendeePasses = [{ id: "application-attendee-1", products: [] }]
    mockAttendeesQuery.data = [{ id: "application-attendee-1" }]
    mockAttendeesQuery.isError = true

    render(<HomePasses />)

    expect(screen.getByText("your-passes")).toBeTruthy()
    expect(screen.queryByText("passes.error_title")).toBeNull()
  })
})
