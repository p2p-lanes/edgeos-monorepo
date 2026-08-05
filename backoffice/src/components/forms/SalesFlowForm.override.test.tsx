/**
 * Behavioral test for SalesFlowForm's Class-B override wiring (design D1).
 *
 * Deviation note (disclosed): the pure mode/value logic this component
 * relies on (`src/lib/salesFlowOverrides.ts`) was TDD'd RED-first with its
 * own unit tests. This component test verifies the wiring around that pure
 * logic (badge rendering, toggle reveal, submit payload) and was written
 * after the component, approval-style - full component composition made a
 * genuine RED-first cycle impractical (the component doesn't exist until
 * its JSX exists). It still asserts real, non-trivial production behavior.
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
  PopupsService: {
    getPopup: vi.fn(),
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

import { PopupsService, SalesFlowsService } from "@/client"
import { SalesFlowForm } from "./SalesFlowForm"

const mockGetPopup = vi.mocked(PopupsService.getPopup)
const mockUpdateSalesFlow = vi.mocked(SalesFlowsService.updateSalesFlow)

const POPUP_BASE = {
  id: "popup-1",
  name: "Test Popup",
  slug: "test-popup",
  tenant_id: "tenant-1",
  allows_scholarship: true,
  application_fee_amount: null,
  open_checkout_signing_secret: "test-signing-secret-value",
}

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
  allows_scholarship: null,
  application_fee_amount: null,
  open_checkout_signing_secret: null,
}

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

describe("SalesFlowForm - Class-B override wiring (design D1)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPopup.mockResolvedValue(
      POPUP_BASE as Awaited<ReturnType<typeof PopupsService.getPopup>>,
    )
  })

  it('shows "Inherited from event" with the popup value when the flow column is NULL', async () => {
    render(
      <SalesFlowForm
        popupId="popup-1"
        defaultValues={
          FLOW_BASE as Awaited<
            ReturnType<typeof SalesFlowsService.getSalesFlow>
          >
        }
        onSuccess={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )

    await waitFor(() =>
      expect(screen.getByText(/inherited from event: on/i)).toBeInTheDocument(),
    )
  })

  it("reveals an editable control and sends the override in the update payload", async () => {
    const user = userEvent.setup()
    mockUpdateSalesFlow.mockResolvedValue(
      FLOW_BASE as Awaited<
        ReturnType<typeof SalesFlowsService.updateSalesFlow>
      >,
    )

    render(
      <SalesFlowForm
        popupId="popup-1"
        defaultValues={
          FLOW_BASE as Awaited<
            ReturnType<typeof SalesFlowsService.getSalesFlow>
          >
        }
        onSuccess={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )

    await waitFor(() => screen.getByTestId("override-allows_scholarship"))

    await user.click(screen.getByTestId("override-allows_scholarship"))
    const toggle = screen.getAllByRole("switch").at(-1)
    expect(toggle).toBeDefined()
    // The popup value is true, so the override control seeds to true on
    // reveal; this click flips it off, so the override sent is false.
    await user.click(toggle as HTMLElement)

    await user.click(screen.getByRole("button", { name: /save changes/i }))

    await waitFor(() => {
      expect(mockUpdateSalesFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          flowId: "flow-1",
          requestBody: expect.objectContaining({ allows_scholarship: false }),
        }),
      )
    })
  })

  it("seeds a boolean override from the popup value and keeps it on save without toggling", async () => {
    const user = userEvent.setup()
    mockUpdateSalesFlow.mockResolvedValue(
      FLOW_BASE as Awaited<
        ReturnType<typeof SalesFlowsService.updateSalesFlow>
      >,
    )

    render(
      <SalesFlowForm
        popupId="popup-1"
        defaultValues={
          FLOW_BASE as Awaited<
            ReturnType<typeof SalesFlowsService.getSalesFlow>
          >
        }
        onSuccess={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )

    await waitFor(() => screen.getByTestId("override-allows_scholarship"))
    await user.click(screen.getByTestId("override-allows_scholarship"))

    await user.click(screen.getByRole("button", { name: /save changes/i }))

    await waitFor(() => {
      expect(mockUpdateSalesFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          flowId: "flow-1",
          requestBody: expect.objectContaining({ allows_scholarship: true }),
        }),
      )
    })
  })

  it("sends null for an overridden currency field left untouched", async () => {
    const user = userEvent.setup()
    mockUpdateSalesFlow.mockResolvedValue(
      FLOW_BASE as Awaited<
        ReturnType<typeof SalesFlowsService.updateSalesFlow>
      >,
    )

    render(
      <SalesFlowForm
        popupId="popup-1"
        defaultValues={
          FLOW_BASE as Awaited<
            ReturnType<typeof SalesFlowsService.getSalesFlow>
          >
        }
        onSuccess={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )

    await waitFor(() => screen.getByTestId("override-application_fee_amount"))
    await user.click(screen.getByTestId("override-application_fee_amount"))

    await user.click(screen.getByRole("button", { name: /save changes/i }))

    await waitFor(() => {
      expect(mockUpdateSalesFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          flowId: "flow-1",
          requestBody: expect.objectContaining({
            application_fee_amount: null,
          }),
        }),
      )
    })
  })

  it("never renders the signing secret value and edits it as a password field", async () => {
    const user = userEvent.setup()

    render(
      <SalesFlowForm
        popupId="popup-1"
        defaultValues={
          FLOW_BASE as Awaited<
            ReturnType<typeof SalesFlowsService.getSalesFlow>
          >
        }
        onSuccess={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )

    await waitFor(() =>
      expect(
        screen.getByText(/inherited from event: configured/i),
      ).toBeInTheDocument(),
    )
    expect(
      screen.queryByText(POPUP_BASE.open_checkout_signing_secret),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByTestId("override-open_checkout_signing_secret"),
    )

    // Revealing the override renders a password input, not plain text, so
    // the browser masks it visually even though the field is now editable.
    expect(document.querySelector('input[type="password"]')).toBeInTheDocument()
    expect(document.querySelector('input[type="text"]')?.value).not.toBe(
      POPUP_BASE.open_checkout_signing_secret,
    )
  })
})
