import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react"
import type { ReactNode } from "react"
import { createElement } from "react"
import { describe, expect, it, vi } from "vitest"
import type { ApplicationPublic, PopupPublic } from "@/client"
import { ApplicationsService, SalesFlowsService } from "@/client"
import type { ApplicationFormSchema } from "@/types/form-schema"
import { useSubmitApplication } from "../hooks/use-submit-application"
import { FlowPicker } from "./FlowPicker"

vi.mock("@/client", () => ({
  ApiError: class ApiError extends Error {},
  SalesFlowsService: {
    listPortalSalesFlows: vi.fn(),
  },
  ApplicationsService: {
    updateMyApplication: vi
      .fn()
      .mockResolvedValue({ id: "app-1", status: "draft" }),
    createMyApplication: vi
      .fn()
      .mockResolvedValue({ id: "app-2", status: "draft" }),
  },
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/hooks/useApplicationFee", () => ({
  useApplicationFee: () => ({ createOrResume: vi.fn(), isPending: false }),
}))
vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({ updateApplication: vi.fn() }),
}))

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  )
}

describe("FlowPicker", () => {
  it("renders nothing when only one portal-listed flow exists", async () => {
    vi.mocked(SalesFlowsService.listPortalSalesFlows).mockResolvedValue({
      results: [{ id: "flow-1", slug: "attendee", name: "Attendee", order: 0 }],
      paging: { offset: 0, limit: 1, total: 1 },
    } as never)

    const onSelect = vi.fn()
    const { container } = renderWithClient(
      <FlowPicker popupId="popup-1" onSelect={onSelect} />,
    )

    await waitFor(() => {
      expect(SalesFlowsService.listPortalSalesFlows).toHaveBeenCalled()
    })
    expect(container.innerHTML).toBe("")
  })

  it("auto-selects the single flow via onSelect (no picker shown)", async () => {
    vi.mocked(SalesFlowsService.listPortalSalesFlows).mockResolvedValue({
      results: [{ id: "flow-1", slug: "attendee", name: "Attendee", order: 0 }],
      paging: { offset: 0, limit: 1, total: 1 },
    } as never)

    const onSelect = vi.fn()
    renderWithClient(<FlowPicker popupId="popup-1" onSelect={onSelect} />)

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith("flow-1")
    })
  })

  it("renders a picker and calls onSelect when >1 flow exists", async () => {
    vi.mocked(SalesFlowsService.listPortalSalesFlows).mockResolvedValue({
      results: [
        { id: "flow-1", slug: "attendee", name: "Attendee", order: 0 },
        { id: "flow-2", slug: "vip", name: "VIP Track", order: 1 },
      ],
      paging: { offset: 0, limit: 2, total: 2 },
    } as never)

    renderWithClient(<FlowPicker popupId="popup-1" onSelect={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText("application.flow_picker_title")).toBeTruthy()
    })
    expect(screen.getByText("Attendee")).toBeTruthy()
    expect(screen.getByText("VIP Track")).toBeTruthy()
  })

  it("calls onSelect with the chosen flow id when the user picks a card", async () => {
    vi.mocked(SalesFlowsService.listPortalSalesFlows).mockResolvedValue({
      results: [
        { id: "flow-1", slug: "attendee", name: "Attendee", order: 0 },
        { id: "flow-2", slug: "vip", name: "VIP Track", order: 1 },
      ],
      paging: { offset: 0, limit: 2, total: 2 },
    } as never)

    const onSelect = vi.fn()
    renderWithClient(<FlowPicker popupId="popup-1" onSelect={onSelect} />)

    const vipOption = await screen.findByText("VIP Track")
    fireEvent.click(vipOption)

    expect(onSelect).toHaveBeenCalledWith("flow-2")
  })
})

describe("useSubmitApplication create-vs-update (rel-001 correction)", () => {
  const schema: ApplicationFormSchema = {
    base_fields: {},
    custom_fields: {},
    sections: [],
  }
  const popup = { id: "popup-1" } as PopupPublic

  beforeEach(() => vi.clearAllMocks())

  function wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }

  it("updates when the popup has no flow ambiguity (single/zero-flow)", async () => {
    const existing = { id: "app-1" } as ApplicationPublic
    const { result } = renderHook(
      () =>
        useSubmitApplication({
          popup,
          schema,
          values: {},
          application: existing,
          validate: () => ({ isValid: true, errors: {} }),
        }),
      { wrapper },
    )

    await act(async () => result.current.handleDraft())

    expect(ApplicationsService.updateMyApplication).toHaveBeenCalled()
    expect(ApplicationsService.createMyApplication).not.toHaveBeenCalled()
  })

  it("creates when this door has no application yet", async () => {
    /* The caller resolves `application` for the door being submitted for
       (sdd/sales-flows-rediseno), so null means this door genuinely has
       none — not that another door's is in hand.

       This used to create whenever the gathering had more than one flow,
       even with a draft open, because `application` was popup-scoped and
       could not be proven to belong here. That trade would now break
       editing: the backend's per-human-per-flow guard refuses the second
       application. */
    const { result } = renderHook(
      () =>
        useSubmitApplication({
          popup,
          schema,
          values: {},
          application: null,
          validate: () => ({ isValid: true, errors: {} }),
          salesFlowId: "flow-b",
        }),
      { wrapper },
    )

    await act(async () => result.current.handleDraft())

    expect(ApplicationsService.createMyApplication).toHaveBeenCalled()
    expect(ApplicationsService.updateMyApplication).not.toHaveBeenCalled()
  })

  it("edits this door's own draft instead of opening a second one", async () => {
    const existing = { id: "app-1" } as ApplicationPublic
    const { result } = renderHook(
      () =>
        useSubmitApplication({
          popup,
          schema,
          values: {},
          application: existing,
          validate: () => ({ isValid: true, errors: {} }),
          salesFlowId: "flow-b",
        }),
      { wrapper },
    )

    await act(async () => result.current.handleDraft())

    expect(ApplicationsService.updateMyApplication).toHaveBeenCalled()
    expect(ApplicationsService.createMyApplication).not.toHaveBeenCalled()
  })
})
