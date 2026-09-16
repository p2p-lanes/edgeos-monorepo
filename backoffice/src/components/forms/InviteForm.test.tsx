import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  deleteInvite: vi.fn(),
  navigate: vi.fn(),
  updateInvite: vi.fn(),
}))

vi.mock("@/client", () => ({
  InvitesService: {
    createInvite: vi.fn(),
    deleteInvite: mocks.deleteInvite,
    updateInvite: mocks.updateInvite,
  },
}))

vi.mock("@tanstack/react-router", () => ({
  useBlocker: () => ({ status: "unblocked" }),
  useNavigate: () => mocks.navigate,
}))

vi.mock("@/components/applications/SourceApplicationsSection", () => ({
  SourceApplicationsSection: ({ source }: { source: string }) => (
    <div data-testid="application-source">{source}</div>
  ),
}))

vi.mock("@/components/Common/DangerZone", () => ({
  DangerZone: ({ confirmText }: { confirmText: string }) => (
    <button type="button">{confirmText}</button>
  ),
}))

vi.mock("@/components/forms/FlowPicker", () => ({
  FlowPicker: () => <div>Flow picker</div>,
}))

vi.mock("@/contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    selectedPopupId: "popup-1",
    isContextReady: true,
  }),
}))

vi.mock("@/hooks/useAuth", () => ({
  default: () => ({ isOperatorOrAbove: true }),
}))

vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}))

import { InviteForm } from "./InviteForm"

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function referral(currentUses: number) {
  return {
    id: "referral-1",
    popup_id: "popup-1",
    sales_flow_id: "flow-1",
    token: "ada-code",
    recipient_email: null,
    discount_percentage: 0,
    auto_approve: true,
    express_checkout: true,
    is_disabled: false,
    max_uses: 10,
    current_uses: currentUses,
    used_at: null,
    redeemed_by_human_id: null,
    expires_at: null,
    created_by: null,
    referrer_human_id: "human-1",
    created_at: "2026-09-01T12:00:00Z",
    updated_at: "2026-09-01T12:00:00Z",
  }
}

function invite(currentUses: number) {
  return {
    ...referral(currentUses),
    id: "invite-1",
    token: "vip-code",
    created_by: "admin-1",
    referrer_human_id: null,
  }
}

describe("InviteForm referral lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateInvite.mockResolvedValue({})
    mocks.deleteInvite.mockResolvedValue(undefined)
  })

  it("keeps referral auto approval enabled and uses referral attribution", async () => {
    const user = userEvent.setup()
    render(
      <InviteForm defaultValues={referral(0) as never} onSuccess={vi.fn()} />,
      { wrapper: Wrapper },
    )

    expect(screen.queryByText("Auto Approve")).not.toBeInTheDocument()
    expect(screen.getByTestId("application-source")).toHaveTextContent(
      "referral",
    )
    expect(
      screen.getByRole("button", { name: "Delete Referral" }),
    ).toBeInTheDocument()

    const disabledSwitch = document.querySelector("#invite_is_disabled")
    expect(disabledSwitch).not.toBeNull()
    fireEvent.click(disabledSwitch as Element)
    await user.click(screen.getByRole("button", { name: "Save Changes" }))

    await waitFor(() =>
      expect(mocks.updateInvite).toHaveBeenCalledWith({
        inviteId: "referral-1",
        requestBody: expect.objectContaining({
          auto_approve: true,
          is_disabled: true,
        }),
      }),
    )
  })

  it("does not offer permanent deletion after a referral was used", () => {
    render(
      <InviteForm defaultValues={referral(1) as never} onSuccess={vi.fn()} />,
      { wrapper: Wrapper },
    )

    expect(
      screen.queryByRole("button", { name: "Delete Referral" }),
    ).not.toBeInTheDocument()
  })

  it("uses invite attribution for links created by the team", () => {
    render(
      <InviteForm defaultValues={invite(0) as never} onSuccess={vi.fn()} />,
      { wrapper: Wrapper },
    )

    expect(screen.getByText("Auto Approve")).toBeInTheDocument()
    expect(screen.getByTestId("application-source")).toHaveTextContent("invite")
    expect(
      screen.getByRole("button", { name: "Delete Invite" }),
    ).toBeInTheDocument()
  })
})
