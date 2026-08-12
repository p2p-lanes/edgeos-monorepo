/**
 * The flow's own settings, with nowhere else for a value to come from.
 *
 * Replaces SalesFlowForm.override.test.tsx. That file described a
 * three-state inherit/override control per Class-B column, which existed
 * only because the schema let a flow read the popup's value through a NULL.
 * sdd/sales-flows-rediseno slice 7 gave each flow its own copy, so the
 * control has no second source to choose between and the whole mechanism
 * is gone rather than restyled.
 *
 * These cases pin what replaced it: the form shows the flow's stored value,
 * and saving sends that value straight through.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  SalesFlowsService: {
    updateSalesFlow: vi.fn(),
    deleteSalesFlow: vi.fn(),
  },
}))

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock("@/hooks/useAuth", () => ({
  default: () => ({ isAdmin: true, isOperatorOrAbove: true }),
}))

vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}))

vi.mock("@/hooks/useUnsavedChanges", () => ({
  useUnsavedChanges: () => ({ state: "unblocked" }),
  UnsavedChangesDialog: () => null,
}))

import { SalesFlowsService } from "@/client"
import { SalesFlowForm } from "./SalesFlowForm"

const mockUpdateSalesFlow = vi.mocked(SalesFlowsService.updateSalesFlow)

const FLOW_BASE = {
  id: "flow-1",
  tenant_id: "tenant-1",
  popup_id: "popup-1",
  slug: "default",
  name: "Default Flow",
  type: "application" as const,
  visibility: "portal_listed" as const,
  is_default: true,
  order: 0,
  reviewers_mode: "inherit" as const,
  identity_mode: "portal_auth" as const,
  allows_scholarship: true,
  allows_coupons: false,
  application_fee_amount: "25.00",
  open_checkout_signing_secret: "test-signing-secret-value",
}

type FlowDefaults = Awaited<ReturnType<typeof SalesFlowsService.getSalesFlow>>

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function renderForm(overrides: Partial<typeof FLOW_BASE> = {}) {
  return render(
    <SalesFlowForm
      popupId="popup-1"
      defaultValues={{ ...FLOW_BASE, ...overrides } as FlowDefaults}
      onSuccess={vi.fn()}
    />,
    { wrapper: makeWrapper() },
  )
}

describe("SalesFlowForm - flow-owned settings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateSalesFlow.mockResolvedValue(FLOW_BASE as FlowDefaults)
  })

  it("never offers a settings value a second source", async () => {
    renderForm()

    await waitFor(() =>
      expect(screen.getByLabelText(/scholarship/i)).toBeInTheDocument(),
    )

    // The badge every Class-B field used to carry. Its absence is the whole
    // point of slice 7: the flow stores the value, so there is no event
    // value to fall back to and nothing to disclose.
    //
    // `reviewers_mode` still offers an inherit/override choice and is meant
    // to. Reviewers stay at popup level by decision, and a flow opts out of
    // them by hand — a stored answer, not a fallback.
    expect(screen.queryByText(/inherited from event/i)).not.toBeInTheDocument()
  })

  it("shows the flow's own boolean value as a plain control", async () => {
    renderForm({ allows_scholarship: true })

    const control = await screen.findByLabelText(/scholarship/i)

    expect(control).toBeChecked()
  })

  it("sends the edited value straight through on save", async () => {
    const user = userEvent.setup()
    renderForm({ allows_scholarship: true })

    const control = await screen.findByLabelText(/scholarship/i)
    await user.click(control)
    await user.click(screen.getByRole("button", { name: /save/i }))

    await waitFor(() => expect(mockUpdateSalesFlow).toHaveBeenCalled())
    const payload = mockUpdateSalesFlow.mock.calls[0][0].requestBody as Record<
      string,
      unknown
    >
    expect(payload.allows_scholarship).toBe(false)
  })

  it("keeps an untouched value instead of clearing it", async () => {
    const user = userEvent.setup()
    renderForm({ allows_scholarship: true, allows_coupons: false })

    await screen.findByLabelText(/scholarship/i)
    await user.click(screen.getByRole("button", { name: /save/i }))

    await waitFor(() => expect(mockUpdateSalesFlow).toHaveBeenCalled())
    const payload = mockUpdateSalesFlow.mock.calls[0][0].requestBody as Record<
      string,
      unknown
    >
    expect(payload.allows_scholarship).toBe(true)
    expect(payload.allows_coupons).toBe(false)
  })

  it("hides the application settings on a flow that never has applications", async () => {
    /* A direct sale produces no application, so a scholarship toggle there
       is configuration that can never run. */
    renderForm({ type: "direct" as never })

    await screen.findByLabelText(/success url/i)

    expect(screen.queryByLabelText(/scholarship/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/application settings/i)).not.toBeInTheDocument()
    // Every field of that cadence is application-only, so the whole heading
    // goes with them — an empty section reads as a missing feature.
    expect(screen.queryByText(/abandoned application/i)).not.toBeInTheDocument()
  })

  it("keeps the cadences that apply to any sale", async () => {
    renderForm({ type: "direct" as never })

    // Each cadence is its own headed group naming the email it paces, so
    // "Delay (days)" is read through the heading above it rather than
    // repeated into a label nobody could parse.
    expect(await screen.findByText("Abandoned Cart")).toBeInTheDocument()
    expect(screen.getByText("Purchase Reminder")).toBeInTheDocument()
    expect(screen.getByLabelText(/allows coupons/i)).toBeInTheDocument()
  })

  it("never renders the signing secret in clear text", async () => {
    renderForm()

    await screen.findByLabelText(/scholarship/i)

    expect(
      screen.queryByDisplayValue("test-signing-secret-value"),
    ).not.toBeInTheDocument()
  })
})
