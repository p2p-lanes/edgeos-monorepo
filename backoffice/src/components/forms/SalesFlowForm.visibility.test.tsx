import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  SalesFlowsService: {
    createSalesFlow: vi.fn(),
    updateSalesFlow: vi.fn(),
    deleteSalesFlow: vi.fn(),
    listSettingsByType: vi.fn(),
  },
}))

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
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

vi.mock("@/hooks/useUnsavedChanges", () => ({
  useUnsavedChanges: () => ({ state: "unblocked" }),
  UnsavedChangesDialog: () => null,
}))

import { type SalesFlowPublic, SalesFlowsService } from "@/client"
import { SalesFlowForm } from "./SalesFlowForm"

const mockSettingsByType = vi.mocked(SalesFlowsService.listSettingsByType)

const EDIT_FLOW = {
  id: "flow-1",
  tenant_id: "tenant-1",
  popup_id: "popup-1",
  slug: "attendee",
  name: "Attendee",
  type: "application",
  visibility: "portal_listed",
  is_default: true,
  order: 0,
  reviewers_mode: "inherit",
  identity_mode: "portal_auth",
} as SalesFlowPublic

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

function renderForm(defaultValues?: SalesFlowPublic) {
  return render(
    <SalesFlowForm
      popupId="popup-1"
      defaultValues={defaultValues}
      onSuccess={vi.fn()}
    />,
    { wrapper: makeWrapper() },
  )
}

async function choose(label: string, option: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole("combobox", { name: label }))
  await user.click(screen.getByRole("option", { name: option }))
}

function visibilitySelect() {
  return screen.getByRole("combobox", { name: "Flow visibility" })
}

describe("SalesFlowForm visibility defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSettingsByType.mockResolvedValue({
      settings: { application: [], direct: [], upsale: [] },
    })
  })

  it("updates the recommended visibility while a new flow remains auto-managed", async () => {
    renderForm()

    expect(visibilitySelect()).toHaveTextContent("Portal Listed")

    await choose("Flow type", "Direct")
    expect(visibilitySelect()).toHaveTextContent("Direct URL Only")

    await choose("Flow type", "Upsale")
    expect(visibilitySelect()).toHaveTextContent("Portal Listed")
  })

  it("preserves a manual visibility choice across later type changes", async () => {
    renderForm()

    await choose("Flow visibility", "Direct URL Only")
    await choose("Flow type", "Direct")
    await choose("Flow type", "Upsale")

    expect(visibilitySelect()).toHaveTextContent("Direct URL Only")
  })

  it("never auto-changes visibility while editing an existing flow", async () => {
    renderForm(EDIT_FLOW)

    await choose("Flow type", "Direct")

    expect(visibilitySelect()).toHaveTextContent("Portal Listed")
  })
})
