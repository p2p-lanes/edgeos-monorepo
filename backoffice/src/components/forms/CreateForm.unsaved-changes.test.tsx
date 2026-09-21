import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createGroup: vi.fn(),
  createInvite: vi.fn(),
  showErrorToast: vi.fn(),
  blockerOptions: null as {
    shouldBlockFn: () => boolean
    disabled: boolean
  } | null,
}))

vi.mock("@/client", () => ({
  GroupsService: { createGroup: mocks.createGroup },
  InvitesService: { createInvite: mocks.createInvite },
  PopupsService: { getPopup: vi.fn().mockResolvedValue({ id: "popup-1" }) },
  SalesFlowsService: {
    listSalesFlows: vi.fn().mockResolvedValue({
      results: [
        {
          id: "flow-1",
          name: "Default flow",
          type: "application",
          is_default: true,
        },
      ],
      paging: { limit: 100, offset: 0, total: 1 },
    }),
  },
}))

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useBlocker: (options: {
    shouldBlockFn: () => boolean
    disabled: boolean
  }) => {
    mocks.blockerOptions = options
    return { status: "unblocked" }
  },
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
    showErrorToast: mocks.showErrorToast,
  }),
}))

import { GroupForm } from "./GroupForm"
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

describe.each([
  {
    name: "GroupForm",
    Form: GroupForm,
    create: mocks.createGroup,
    placeholder: "Group Name",
    submitLabel: "Create Group",
  },
  {
    name: "InviteForm",
    Form: InviteForm,
    create: mocks.createInvite,
    placeholder: "Invite token (auto-generated if empty)",
    submitLabel: "Create Invite",
  },
])("$name unsaved changes", ({ Form, create, placeholder, submitLabel }) => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.blockerOptions = null
    create.mockResolvedValue({ id: "created-1" })
  })

  it("protects edits before saving", async () => {
    const user = userEvent.setup()
    render(<Form onSuccess={vi.fn()} />, { wrapper: Wrapper })

    await user.type(screen.getByPlaceholderText(placeholder), "unsaved")

    expect(mocks.blockerOptions?.disabled).toBe(false)
    expect(mocks.blockerOptions?.shouldBlockFn()).toBe(true)
  })

  it("allows success navigation even after the default flow is restored", async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn(() => {
      expect(mocks.blockerOptions?.shouldBlockFn()).toBe(false)
    })
    render(<Form onSuccess={onSuccess} />, { wrapper: Wrapper })

    await user.type(screen.getByPlaceholderText(placeholder), "saved")
    await user.click(screen.getByRole("button", { name: submitLabel }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
    expect(create).toHaveBeenCalledWith({
      requestBody: expect.objectContaining({ sales_flow_id: "flow-1" }),
    })
    // Keep the form mounted while navigation settles so the real FlowPicker
    // effect runs again after reset, reproducing the redirect race.
    await waitFor(() => {
      expect(screen.getByPlaceholderText(placeholder)).toHaveValue("")
      expect(
        screen.getByRole("combobox", { name: "Sales flow" }),
      ).toHaveTextContent("Default flow")
    })
    expect(mocks.blockerOptions?.shouldBlockFn()).toBe(false)
    expect(mocks.blockerOptions?.disabled).toBe(true)
  })

  it("protects edits while saving and after a failed save", async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    let rejectSave!: (error: Error) => void
    create.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectSave = reject
        }),
    )
    render(<Form onSuccess={onSuccess} />, { wrapper: Wrapper })

    await user.type(screen.getByPlaceholderText(placeholder), "unsaved")
    await user.click(screen.getByRole("button", { name: submitLabel }))

    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(mocks.blockerOptions?.shouldBlockFn()).toBe(true)

    await act(async () => rejectSave(new Error("Save failed")))

    await waitFor(() => expect(mocks.showErrorToast).toHaveBeenCalledOnce())
    expect(onSuccess).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText(placeholder)).toHaveValue("unsaved")
    expect(mocks.blockerOptions?.disabled).toBe(false)
    expect(mocks.blockerOptions?.shouldBlockFn()).toBe(true)
  })
})
