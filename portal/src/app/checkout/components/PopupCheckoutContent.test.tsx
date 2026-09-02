import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { PopupCheckoutContent } from "./PopupCheckoutContent"

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

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
    push: mockReplace,
    replace: mockReplace,
  }),
}))

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
}))

vi.mock("@/client", () => ({
  ApiError: class ApiError extends Error {
    status = 500
  },
  ApplicationsService: {
    detachCompanion: vi.fn(),
    getMyParticipation: vi.fn(),
  },
}))

vi.mock("@/hooks/useApplicationSchema", () => ({
  useApplicationSchema: (
    popupId: string | undefined,
    salesFlowId: string | undefined,
  ) => mockUseApplicationSchema(popupId, salesFlowId),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
  default: ({ navExtraContent }: { navExtraContent?: ReactNode }) => (
    <div>
      {navExtraContent}
      passes-flow
    </div>
  ),
}))

vi.mock("@/components/Sidebar/SidebarComponents", () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock("@/providers/passesProvider", () => ({
  default: ({
    children,
    salesFlowId,
  }: {
    children: ReactNode
    salesFlowId?: string | null
  }) => (
    <div data-flow-id={salesFlowId ?? ""} data-testid="passes-provider">
      {children}
    </div>
  ),
}))

vi.mock("@/providers/checkoutProvider", () => ({
  CheckoutProvider: ({
    children,
    salesFlowId,
  }: {
    children: ReactNode
    salesFlowId?: string | null
  }) => (
    <div data-flow-id={salesFlowId ?? ""} data-testid="checkout-provider">
      {children}
    </div>
  ),
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

const directPopup = {
  ...popup,
  takes_applications: false,
} as const

describe("PopupCheckoutContent application schema gating", () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockSetCityPreselected.mockReset()
    mockUseApplicationSchema.mockReset()
    mockUseCheckoutState.mockReset()
    mockGetRelevantApplication.mockReset()
    mockGetCity.mockReset()
    mockUseQueryClient.mockReset()
    mockUseQueryClient.mockReturnValue({
      removeQueries: vi.fn(),
    })
    mockUseApplicationSchema.mockReturnValue({
      data: undefined,
      isLoading: false,
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

    renderWithClient(
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

    renderWithClient(
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

    renderWithClient(
      <PopupCheckoutContent
        popup={popup as never}
        background={{ className: "bg" }}
      />,
    )

    expect(screen.getByText("schema-form")).toBeTruthy()
  })

  it("clears every query before returning a direct checkout to email entry", async () => {
    const clear = vi.fn()
    const removeQueries = vi.fn()
    const setCheckoutState = vi.fn()
    mockUseQueryClient.mockReturnValue({ clear, removeQueries })
    mockUseCheckoutState.mockReturnValue({
      checkoutState: "passes",
      isSubmitting: false,
      errorMessage: null,
      handleSubmit: vi.fn(),
      setCheckoutState,
    })

    renderWithClient(
      <PopupCheckoutContent
        popup={directPopup as never}
        background={{ className: "bg" }}
      />,
    )

    fireEvent.click(
      screen.getByRole("button", { name: "Signed in as human@example.com" }),
    )
    fireEvent.click(await screen.findByRole("button", { name: "Change email" }))

    expect(clear).toHaveBeenCalledOnce()
    expect(removeQueries).not.toHaveBeenCalled()
    expect(setCheckoutState).toHaveBeenCalledWith("form")
  })

  it("keeps products hidden while a manual-approval link is in review", () => {
    mockUseApplicationSchema.mockReturnValue({
      data: {
        base_fields: {},
        custom_fields: {},
        sections: [],
      },
      isLoading: false,
    })
    mockGetRelevantApplication.mockReturnValue({ status: "in review" })

    renderWithClient(
      <PopupCheckoutContent
        popup={popup as never}
        background={{ className: "bg" }}
        requiresManualApproval
      />,
    )

    expect(screen.getByText("checkout.application_pending_title")).toBeTruthy()
    expect(screen.queryByText("passes-flow")).toBeNull()
    fireEvent.click(screen.getByRole("button"))
    expect(mockReplace).toHaveBeenCalledWith("/portal/popup-slug")
  })

  it("scopes both checkout providers to the application flow", () => {
    mockUseApplicationSchema.mockReturnValue({
      data: undefined,
      isLoading: false,
    })
    mockUseCheckoutState.mockReturnValue({
      checkoutState: "passes",
      isSubmitting: false,
      errorMessage: null,
      handleSubmit: vi.fn(),
      setCheckoutState: vi.fn(),
    })
    mockGetRelevantApplication.mockReturnValue({
      id: "application-1",
      sales_flow_id: "flow-application",
      status: "approved",
    })

    renderWithClient(
      <PopupCheckoutContent
        popup={directPopup as never}
        background={{ className: "bg" }}
      />,
    )

    expect(screen.getByTestId("passes-provider").dataset.flowId).toBe(
      "flow-application",
    )
    expect(screen.getByTestId("checkout-provider").dataset.flowId).toBe(
      "flow-application",
    )
  })

  it("does not substitute another application when an explicit flow is selected", () => {
    mockUseApplicationSchema.mockReturnValue({
      data: undefined,
      isLoading: false,
    })
    mockUseCheckoutState.mockReturnValue({
      checkoutState: "passes",
      isSubmitting: false,
      errorMessage: null,
      handleSubmit: vi.fn(),
      setCheckoutState: vi.fn(),
    })
    mockGetRelevantApplication.mockImplementation((flowId?: string) =>
      flowId
        ? null
        : {
            id: "application-other",
            sales_flow_id: "flow-other",
            status: "approved",
          },
    )

    renderWithClient(
      <PopupCheckoutContent
        popup={popup as never}
        background={{ className: "bg" }}
        salesFlowId="flow-selected"
      />,
    )

    expect(screen.getByTestId("passes-provider").dataset.flowId).toBe(
      "flow-selected",
    )
    expect(screen.getByTestId("checkout-provider").dataset.flowId).toBe(
      "flow-selected",
    )
    expect(mockGetRelevantApplication).toHaveBeenCalledWith("flow-selected")
    expect(mockUseApplicationSchema).toHaveBeenCalledWith(
      "popup-1",
      "flow-selected",
    )
    expect(mockUseCheckoutState).toHaveBeenCalledWith(
      expect.objectContaining({ salesFlowId: "flow-selected" }),
    )
  })
})
