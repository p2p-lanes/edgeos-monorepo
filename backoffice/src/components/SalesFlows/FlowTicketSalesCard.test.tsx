import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { type SalesFlowPublic, SalesFlowsService } from "@/client"
import { FlowTicketSalesCard } from "./FlowTicketSalesCard"

const { showErrorToast, showSuccessToast } = vi.hoisted(() => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}))

vi.mock("@/client", () => ({
  SalesFlowsService: { updateSalesFlow: vi.fn() },
}))

vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({ showSuccessToast, showErrorToast }),
}))

const openFlow = {
  id: "flow-1",
  name: "General admission",
  slug: "general",
  type: "application",
  ticket_sales_status: "open",
  coming_soon_title: null,
  coming_soon_message: null,
} as SalesFlowPublic

function renderCard(flow: SalesFlowPublic) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(queryClient, "invalidateQueries")
  render(
    <QueryClientProvider client={queryClient}>
      <FlowTicketSalesCard flow={flow} />
    </QueryClientProvider>,
  )
  return { user: userEvent.setup(), invalidate }
}

describe("Holding a flow's ticket sales", () => {
  beforeEach(() => vi.resetAllMocks())

  it("shows an open flow without the coming-soon copy or a save button", () => {
    renderCard(openFlow)

    expect(screen.getByText("Ticket sales are open")).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "Sales open" })).toBeChecked()
    expect(screen.queryByLabelText("Coming soon title")).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Save ticket sales" }),
    ).toBeNull()
  })

  it("saves the hold together with the organiser's copy", async () => {
    vi.mocked(SalesFlowsService.updateSalesFlow).mockResolvedValue({
      ...openFlow,
      ticket_sales_status: "coming_soon",
      coming_soon_title: "Tickets drop in May",
      coming_soon_message: null,
    })
    const { user, invalidate } = renderCard(openFlow)

    await user.click(screen.getByRole("switch", { name: "Sales open" }))
    await user.type(
      screen.getByLabelText("Coming soon title"),
      "  Tickets drop in May ",
    )
    await user.click(screen.getByRole("button", { name: "Save ticket sales" }))

    await waitFor(() =>
      expect(SalesFlowsService.updateSalesFlow).toHaveBeenCalledExactlyOnceWith(
        {
          flowId: "flow-1",
          requestBody: {
            ticket_sales_status: "coming_soon",
            coming_soon_title: "Tickets drop in May",
            coming_soon_message: null,
          },
        },
      ),
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["sales-flows"] })
    expect(showSuccessToast).toHaveBeenCalledWith(
      "Ticket sales are now coming soon",
    )
  })

  it("reopens sales from a held flow", async () => {
    vi.mocked(SalesFlowsService.updateSalesFlow).mockResolvedValue(openFlow)
    const { user } = renderCard({
      ...openFlow,
      ticket_sales_status: "coming_soon",
      coming_soon_title: "Soon",
    })

    expect(screen.getByText("Ticket sales coming soon")).toBeInTheDocument()
    expect(screen.getByLabelText("Coming soon title")).toHaveValue("Soon")

    await user.click(screen.getByRole("switch", { name: "Sales open" }))
    await user.click(screen.getByRole("button", { name: "Save ticket sales" }))

    await waitFor(() =>
      expect(SalesFlowsService.updateSalesFlow).toHaveBeenCalledWith({
        flowId: "flow-1",
        requestBody: {
          ticket_sales_status: "open",
          coming_soon_title: "Soon",
          coming_soon_message: null,
        },
      }),
    )
  })

  it("discards an unsaved switch", async () => {
    const { user } = renderCard(openFlow)

    await user.click(screen.getByRole("switch", { name: "Sales open" }))
    await user.click(screen.getByRole("button", { name: "Discard" }))

    expect(screen.getByRole("switch", { name: "Sales open" })).toBeChecked()
    expect(SalesFlowsService.updateSalesFlow).not.toHaveBeenCalled()
  })
})
