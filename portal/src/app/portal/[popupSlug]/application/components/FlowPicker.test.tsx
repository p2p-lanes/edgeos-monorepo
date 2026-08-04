import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { SalesFlowsService } from "@/client"
import { FlowPicker } from "./FlowPicker"

vi.mock("@/client", () => ({
  SalesFlowsService: {
    listPortalSalesFlows: vi.fn(),
  },
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
      results: [{ id: "flow-1", slug: "default", name: "Default", order: 0 }],
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
      results: [{ id: "flow-1", slug: "default", name: "Default", order: 0 }],
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
        { id: "flow-1", slug: "default", name: "Default", order: 0 },
        { id: "flow-2", slug: "vip", name: "VIP Track", order: 1 },
      ],
      paging: { offset: 0, limit: 2, total: 2 },
    } as never)

    renderWithClient(<FlowPicker popupId="popup-1" onSelect={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText("application.flow_picker_title")).toBeTruthy()
    })
    expect(screen.getByText("Default")).toBeTruthy()
    expect(screen.getByText("VIP Track")).toBeTruthy()
  })

  it("calls onSelect with the chosen flow id when the user picks a card", async () => {
    vi.mocked(SalesFlowsService.listPortalSalesFlows).mockResolvedValue({
      results: [
        { id: "flow-1", slug: "default", name: "Default", order: 0 },
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

  it("reports needsChoice=false via onResolved when only one flow exists", async () => {
    vi.mocked(SalesFlowsService.listPortalSalesFlows).mockResolvedValue({
      results: [{ id: "flow-1", slug: "default", name: "Default", order: 0 }],
      paging: { offset: 0, limit: 1, total: 1 },
    } as never)

    const onResolved = vi.fn()
    renderWithClient(
      <FlowPicker
        popupId="popup-1"
        onSelect={vi.fn()}
        onResolved={onResolved}
      />,
    )

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledWith({ needsChoice: false })
    })
  })

  it("reports needsChoice=true via onResolved when multiple flows exist", async () => {
    vi.mocked(SalesFlowsService.listPortalSalesFlows).mockResolvedValue({
      results: [
        { id: "flow-1", slug: "default", name: "Default", order: 0 },
        { id: "flow-2", slug: "vip", name: "VIP Track", order: 1 },
      ],
      paging: { offset: 0, limit: 2, total: 2 },
    } as never)

    const onResolved = vi.fn()
    renderWithClient(
      <FlowPicker
        popupId="popup-1"
        onSelect={vi.fn()}
        onResolved={onResolved}
      />,
    )

    await waitFor(() => {
      expect(onResolved).toHaveBeenCalledWith({ needsChoice: true })
    })
  })
})
