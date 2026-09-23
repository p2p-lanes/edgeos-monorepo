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
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  SalesFlowsService: {
    updateSalesFlow: vi.fn(),
    deleteSalesFlow: vi.fn(),
    listSettingsByType: vi.fn(),
  },
  PopupReviewersService: {
    listReviewers: vi.fn(),
    addReviewer: vi.fn(),
    removeReviewer: vi.fn(),
  },
  UsersService: { listUsers: vi.fn() },
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

import {
  type PopupReviewerPublic,
  PopupReviewersService,
  SalesFlowsService,
  UsersService,
} from "@/client"
import { SalesFlowForm } from "./SalesFlowForm"

const mockUpdateSalesFlow = vi.mocked(SalesFlowsService.updateSalesFlow)
const mockSettingsByType = vi.mocked(SalesFlowsService.listSettingsByType)
const mockListReviewers = vi.mocked(PopupReviewersService.listReviewers)
const mockRemoveReviewer = vi.mocked(PopupReviewersService.removeReviewer)
const mockAddReviewer = vi.mocked(PopupReviewersService.addReviewer)

const FLOW_REVIEWER: PopupReviewerPublic = {
  id: "reviewer-1",
  popup_id: "popup-1",
  tenant_id: "tenant-1",
  sales_flow_id: "flow-1",
  user_id: "user-1",
  user_full_name: "Demo Admin",
  user_email: "admin@example.com",
  is_required: false,
  weight_multiplier: 1,
}

function reviewerList(results: PopupReviewerPublic[]) {
  return { results, paging: { offset: 0, limit: 100, total: results.length } }
}

/**
 * Which settings a kind of flow can use is the server's answer now, so the
 * editor asks for it. Both sets are named here rather than sampled: the whole
 * point is that a reviewed flow is never offered a signing secret it can
 * never read, and a shop is never offered a scholarship toggle.
 */
const SETTINGS_BY_TYPE = {
  settings: {
    application: [
      "application_layout",
      "requires_application_fee",
      "application_fee_amount",
      "allows_scholarship",
      "allows_incentive",
      "allows_coupons",
      "abandoned_cart_delay_days",
      "abandoned_cart_repeat_days",
      "abandoned_cart_max_count",
      "purchase_reminder_delay_days",
      "purchase_reminder_repeat_days",
      "purchase_reminder_max_count",
      "abandoned_application_delay_days",
      "abandoned_application_repeat_days",
      "abandoned_application_max_count",
    ],
    direct: [
      "allows_coupons",
      "open_checkout_success_url",
      "open_checkout_cancel_url",
      "open_checkout_signing_secret",
      "abandoned_cart_delay_days",
      "abandoned_cart_repeat_days",
      "abandoned_cart_max_count",
      "purchase_reminder_delay_days",
      "purchase_reminder_repeat_days",
      "purchase_reminder_max_count",
    ],
    upsale: ["allows_coupons"],
  },
}

const FLOW_BASE = {
  id: "flow-1",
  tenant_id: "tenant-1",
  popup_id: "popup-1",
  slug: "attendee",
  name: "Attendee",
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

function renderForm(overrides: Partial<FlowDefaults> = {}) {
  return render(
    <SalesFlowForm
      popupId="popup-1"
      defaultValues={{ ...FLOW_BASE, ...overrides } as FlowDefaults}
      onSuccess={vi.fn()}
    />,
    { wrapper: makeWrapper() },
  )
}

/**
 * Settings groups are closed until somebody opens one, so a test that wants a
 * field has to do what a person does. The closed row still carries the
 * group's answer, which is asserted separately below.
 */
async function openGroup(title: string) {
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole("button", { name: new RegExp(title, "i") }),
  )
}

describe("SalesFlowForm - flow-owned settings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateSalesFlow.mockResolvedValue(FLOW_BASE as FlowDefaults)
    mockSettingsByType.mockResolvedValue(SETTINGS_BY_TYPE as never)
    mockListReviewers.mockResolvedValue(reviewerList([]))
    mockRemoveReviewer.mockResolvedValue(undefined)
    mockAddReviewer.mockResolvedValue(FLOW_REVIEWER)
    vi.mocked(UsersService.listUsers).mockResolvedValue({
      results: [
        {
          id: "user-1",
          email: "admin@example.com",
          full_name: "Demo Admin",
          role: "admin",
          tenant_id: "tenant-1",
        },
      ],
      paging: { offset: 0, limit: 100, total: 1 },
    })
  })

  it("uses primary terminology for the flow identity field", async () => {
    renderForm()

    expect(await screen.findByText("Primary Flow")).toBeInTheDocument()
    expect(
      screen.getByText("Identifies the primary flow for this event"),
    ).toBeInTheDocument()
  })

  it("allows an unused primary flow to be deleted", async () => {
    renderForm()

    expect(
      await screen.findByText(
        "Once you delete this unused sales flow, it and its configuration will be permanently removed.",
      ),
    ).toBeInTheDocument()
  })

  it("never offers a settings value a second source", async () => {
    renderForm()
    await openGroup("Application Settings")

    await waitFor(() =>
      expect(screen.getByLabelText(/scholarship/i)).toBeInTheDocument(),
    )

    // The badge every Class-B field used to carry. Its absence is the whole
    // point of slice 7: the flow stores the value, so there is no event
    // value to fall back to and nothing to disclose.
    expect(screen.queryByText(/inherited from event/i)).not.toBeInTheDocument()
  })

  it("shows the flow's own boolean value as a plain control", async () => {
    renderForm({ allows_scholarship: true })
    await openGroup("Application Settings")

    const control = await screen.findByLabelText(/scholarship/i)

    expect(control).toBeChecked()
  })

  it("sends the edited value straight through on save", async () => {
    const user = userEvent.setup()
    renderForm({ allows_scholarship: true })
    await openGroup("Application Settings")

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

  it("removes a flow's last reviewer without deleting the event's reviewer or resaving override mode", async () => {
    const user = userEvent.setup()
    mockListReviewers.mockResolvedValue(reviewerList([FLOW_REVIEWER]))
    renderForm({ reviewers_mode: "override" })

    await user.click(
      await screen.findByRole("button", {
        name: "Remove reviewer",
        exact: true,
      }),
    )
    expect(mockListReviewers).toHaveBeenCalledWith({
      popupId: "popup-1",
      salesFlowId: "flow-1",
    })
    const dialog = screen.getByRole("dialog", { name: "Remove Reviewer" })
    expect(dialog).toHaveTextContent(
      "This flow will inherit the event's reviewers again.",
    )
    expect(mockRemoveReviewer).not.toHaveBeenCalled()

    mockListReviewers.mockResolvedValue(
      reviewerList([{ ...FLOW_REVIEWER, id: "shared-1", sales_flow_id: null }]),
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Remove Reviewer" }),
    )
    await waitFor(() => {
      expect(mockRemoveReviewer).toHaveBeenCalledExactlyOnceWith({
        popupId: "popup-1",
        userId: "user-1",
        salesFlowId: "flow-1",
      })
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: "Remove reviewer", exact: true }),
      ).not.toBeInTheDocument()
    })
    expect(screen.getByText("Demo Admin")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Save Changes" }))
    await waitFor(() => expect(mockUpdateSalesFlow).toHaveBeenCalled())
    expect(mockUpdateSalesFlow.mock.calls[0][0].requestBody).not.toHaveProperty(
      "reviewers_mode",
    )
  })

  it("allows an inherited reviewer to be assigned to the flow's own list", async () => {
    const user = userEvent.setup()
    mockListReviewers.mockResolvedValue(
      reviewerList([{ ...FLOW_REVIEWER, id: "shared-1", sales_flow_id: null }]),
    )
    renderForm()

    expect(await screen.findByText("Demo Admin")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Remove reviewer", exact: true }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Add Reviewer" }))
    const dialog = screen.getByRole("dialog", { name: "Add Reviewer" })
    await user.click(within(dialog).getByRole("combobox", { name: "User" }))
    await user.click(screen.getByRole("option", { name: "Demo Admin" }))
    mockListReviewers.mockResolvedValue(reviewerList([FLOW_REVIEWER]))
    await user.click(
      within(dialog).getByRole("button", { name: "Add Reviewer" }),
    )

    await waitFor(() => {
      expect(mockAddReviewer).toHaveBeenCalledExactlyOnceWith({
        popupId: "popup-1",
        requestBody: {
          user_id: "user-1",
          sales_flow_id: "flow-1",
          is_required: false,
          weight_multiplier: 1,
        },
      })
    })
    expect(
      await screen.findByRole("button", {
        name: "Remove reviewer",
        exact: true,
      }),
    ).toBeInTheDocument()
  })

  it("preserves draft settings after a rename without sending the old name", async () => {
    const user = userEvent.setup()
    const { rerender } = renderForm()
    await openGroup("Application Settings")
    await user.click(await screen.findByLabelText(/scholarship/i))

    rerender(
      <SalesFlowForm
        popupId="popup-1"
        defaultValues={{ ...FLOW_BASE, name: "Community" } as FlowDefaults}
        onSuccess={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/scholarship/i)).not.toBeChecked()
    await user.click(screen.getByRole("button", { name: /save/i }))

    await waitFor(() => expect(mockUpdateSalesFlow).toHaveBeenCalled())
    const payload = mockUpdateSalesFlow.mock.calls[0][0].requestBody
    expect(payload).not.toHaveProperty("name")
    expect(payload.allows_scholarship).toBe(false)
  })

  it("keeps an untouched value instead of clearing it", async () => {
    const user = userEvent.setup()
    renderForm({ allows_scholarship: true, allows_coupons: false })
    await openGroup("Application Settings")

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
    await openGroup("Open Checkout Redirects")

    await screen.findByLabelText(/success url/i)

    expect(screen.queryByLabelText(/scholarship/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/application settings/i)).not.toBeInTheDocument()
    // Every field of that cadence is application-only, so the whole heading
    // goes with them — an empty section reads as a missing feature.
    expect(screen.queryByText(/abandoned application/i)).not.toBeInTheDocument()
  })

  it("never offers a reviewed flow somewhere to redirect", async () => {
    /* The purchase path refuses an application flow outright, so its success
       URL and signing secret can never be read. The editor offered all three
       until the server started saying which settings each kind can use. */
    renderForm({ type: "application" as never })
    await openGroup("Application Settings")

    await screen.findByLabelText(/scholarship/i)

    expect(
      screen.queryByText(/open checkout redirects/i),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/success url/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/signing secret/i)).not.toBeInTheDocument()
  })

  it("keeps the cadences that apply to any sale", async () => {
    renderForm({ type: "direct" as never })

    // Each cadence is its own group naming the email it paces, and the group
    // says what it currently does without being opened.
    expect(await screen.findByText("Abandoned Cart")).toBeInTheDocument()
    expect(screen.getByText("Purchase Reminder")).toBeInTheDocument()
    expect(
      screen.getByText("Nobody is chased about an unfinished cart"),
    ).toBeInTheDocument()

    await openGroup("Discounts")
    expect(await screen.findByLabelText(/allows coupons/i)).toBeInTheDocument()
  })

  it("never renders the signing secret in clear text", async () => {
    renderForm()
    await openGroup("Application Settings")

    await screen.findByLabelText(/scholarship/i)

    expect(
      screen.queryByDisplayValue("test-signing-secret-value"),
    ).not.toBeInTheDocument()
  })
})
