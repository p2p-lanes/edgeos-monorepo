import { render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { PopupCheckoutContent } from "./PopupCheckoutContent"

const mockReplace = vi.fn()
const mockUseQueryClient = vi.fn()
const mockUseApplicationSchema = vi.fn()
const mockUseCheckoutState = vi.fn()
const mockGetRelevantApplication = vi.fn()
const mockGetCity = vi.fn()
const mockSetCityPreselected = vi.fn()

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>()
  return {
    ...actual,
    useQueryClient: () => mockUseQueryClient(),
  }
})

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}))

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
}))

vi.mock("@/hooks/useApplicationSchema", () => ({
  useApplicationSchema: (popupId: string | undefined) =>
    mockUseApplicationSchema(popupId),
}))

vi.mock("../hooks/useCheckoutState", () => ({
  default: (args: unknown) => mockUseCheckoutState(args),
}))

vi.mock("@/hooks/useAuth", () => ({
  default: () => ({ user: { email: "human@example.com" } }),
}))

vi.mock("@/hooks/useIsAuthenticated", () => ({
  useIsAuthenticated: () => true,
  dispatchAuthChange: vi.fn(),
}))

vi.mock("@/hooks/useResolvedAttendees", () => ({
  default: () => [],
}))

vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    getRelevantApplication: mockGetRelevantApplication,
  }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: mockGetCity,
    setCityPreselected: mockSetCityPreselected,
  }),
}))

vi.mock("@/components/checkout-flow/ScrollyCheckoutFlow", () => ({
  default: () => <div>passes-flow</div>,
}))

vi.mock("./UserInfoForm", () => ({
  default: ({ schema }: { schema?: { sections?: unknown[] } }) => (
    <div>{schema ? "schema-form" : "default-form"}</div>
  ),
}))

vi.mock("./CheckoutLoginGate", () => ({
  default: () => <div>login-gate</div>,
}))

vi.mock("./TransitionScreen", () => ({
  default: () => <div>transition</div>,
}))

vi.mock("./providers/Providers", () => ({
  Providers: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

const popup = {
  id: "popup-1",
  slug: "popup-slug",
  name: "Popup",
  sale_type: "application",
  checkout_mode: "pass_system",
} as const

describe("PopupCheckoutContent application schema gating", () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockSetCityPreselected.mockReset()
    mockUseQueryClient.mockReturnValue({
      removeQueries: vi.fn(),
    })
    mockGetCity.mockReturnValue({ slug: "popup-slug" })
    mockGetRelevantApplication.mockReturnValue(null)
    mockUseCheckoutState.mockReturnValue({
      checkoutState: "form",
      isSubmitting: false,
      errorMessage: null,
      handleSubmit: vi.fn(),
      setCheckoutState: vi.fn(),
    })
  })

  it("keeps checkout open when the schema has application-only special sections", async () => {
    mockUseApplicationSchema.mockReturnValue({
      data: {
        base_fields: {
          email: {
            type: "email",
            label: "Email",
            required: true,
            target: "human",
          },
        },
        custom_fields: {},
        sections: [
          {
            id: "companions",
            label: "Companions",
            description: null,
            order: 1,
            kind: "companions",
          },
        ],
      },
      isLoading: false,
    })

    render(
      <PopupCheckoutContent
        popup={popup as never}
        background={{ className: "bg" }}
      />,
    )

    await waitFor(() => expect(screen.getByText("schema-form")).toBeTruthy())
    expect(mockReplace).not.toHaveBeenCalledWith(
      "/portal/popup-slug/application",
    )
  })

  it("keeps checkout open when unsupported fields are outside the mini form scope", async () => {
    mockUseApplicationSchema.mockReturnValue({
      data: {
        base_fields: {
          email: {
            type: "email",
            label: "Email",
            required: true,
            target: "human",
          },
          weird_field: {
            type: "markdown",
            label: "Weird",
            required: false,
            target: "application",
          },
        },
        custom_fields: {},
        sections: [],
      },
      isLoading: false,
    })

    render(
      <PopupCheckoutContent
        popup={popup as never}
        background={{ className: "bg" }}
      />,
    )

    await waitFor(() => expect(screen.getByText("schema-form")).toBeTruthy())
    expect(mockReplace).not.toHaveBeenCalledWith(
      "/portal/popup-slug/application",
    )
  })

  it("renders the schema-backed checkout form when the schema is supported", () => {
    mockUseApplicationSchema.mockReturnValue({
      data: {
        base_fields: {
          email: {
            type: "email",
            label: "Email",
            required: true,
            target: "human",
          },
        },
        custom_fields: {},
        sections: [],
      },
      isLoading: false,
    })

    render(
      <PopupCheckoutContent
        popup={popup as never}
        background={{ className: "bg" }}
      />,
    )

    expect(screen.getByText("schema-form")).toBeTruthy()
  })
})
