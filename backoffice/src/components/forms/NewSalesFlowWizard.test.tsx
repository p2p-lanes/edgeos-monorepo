import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const navigate = vi.fn()

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}))

vi.mock("@/client", () => ({
  FormFieldsService: { copyFormToFlow: vi.fn() },
  SalesFlowsService: {
    createSalesFlow: vi.fn(),
    listSalesFlows: vi.fn(),
    previewSalesFlowStart: vi.fn(),
  },
  TicketingStepsService: { copyStepsToFlow: vi.fn() },
}))

vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}))

import {
  FormFieldsService,
  SalesFlowsService,
  TicketingStepsService,
} from "@/client"
import { NewSalesFlowWizard } from "./NewSalesFlowWizard"

const mockListSalesFlows = vi.mocked(SalesFlowsService.listSalesFlows)
const mockCreateSalesFlow = vi.mocked(SalesFlowsService.createSalesFlow)
const mockPreviewSalesFlowStart = vi.mocked(
  SalesFlowsService.previewSalesFlowStart,
)
const mockCopyStepsToFlow = vi.mocked(TicketingStepsService.copyStepsToFlow)
const mockCopyFormToFlow = vi.mocked(FormFieldsService.copyFormToFlow)

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe("NewSalesFlowWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListSalesFlows.mockResolvedValue({
      results: [
        { id: "application-source", name: "Attendee", type: "application" },
        { id: "direct-source", name: "Sponsors", type: "direct" },
      ],
      paging: { limit: 100, offset: 0, total: 2 },
    } as never)
    mockPreviewSalesFlowStart.mockResolvedValue({
      flow_type: "application",
      source_kind: "fresh",
      source_name: null,
      starts_with: {},
      left_empty: [],
      not_carried_over: [],
    } as never)
    mockCreateSalesFlow.mockResolvedValue({ id: "new-flow" } as never)
    mockCopyStepsToFlow.mockResolvedValue({ steps: 1 } as never)
    mockCopyFormToFlow.mockResolvedValue({
      sections: 0,
      base_fields: 0,
      fields: 0,
    } as never)
  })

  it("defaults to fresh and never renders a cross-kind copy option", async () => {
    render(
      <Wrapper>
        <NewSalesFlowWizard popupId="popup-1" />
      </Wrapper>,
    )

    await userEvent.click(
      screen.getByRole("button", { name: /people apply first/i }),
    )

    expect(
      (await screen.findAllByText("Start from scratch")).length,
    ).toBeGreaterThan(0)
    expect(
      screen.queryByText(/copy a flow of a different kind/i),
    ).not.toBeInTheDocument()
  })

  it("copies only an explicitly selected same-kind source", async () => {
    render(
      <Wrapper>
        <NewSalesFlowWizard popupId="popup-1" />
      </Wrapper>,
    )

    await userEvent.click(
      screen.getByRole("button", { name: /people apply first/i }),
    )
    await userEvent.click(screen.getByRole("button", { name: "Change" }))
    await userEvent.click(
      await screen.findByRole("button", { name: /a copy of attendee/i }),
    )
    expect(
      screen.queryByRole("button", { name: /a copy of sponsors/i }),
    ).not.toBeInTheDocument()

    await userEvent.type(screen.getByLabelText("Name"), "Volunteers")
    await userEvent.click(
      screen.getByRole("button", { name: /create the flow/i }),
    )

    await waitFor(() => {
      expect(mockCreateSalesFlow).toHaveBeenCalledWith({
        requestBody: {
          popup_id: "popup-1",
          name: "Volunteers",
          slug: "volunteers",
          type: "application",
          start_from: "application-source",
        },
      })
    })
    expect(mockCopyStepsToFlow).toHaveBeenCalledWith({
      targetFlowId: "new-flow",
      requestBody: { source_flow_id: "application-source" },
    })
    expect(mockCopyFormToFlow).toHaveBeenCalledWith({
      targetFlowId: "new-flow",
      requestBody: { source_flow_id: "application-source" },
    })
  })

  it("replaces the creation route after success", async () => {
    render(
      <Wrapper>
        <NewSalesFlowWizard popupId="popup-1" />
      </Wrapper>,
    )

    await userEvent.click(
      screen.getByRole("button", { name: /people apply first/i }),
    )
    await userEvent.type(screen.getByLabelText("Name"), "Volunteers")
    await userEvent.click(
      screen.getByRole("button", { name: /create the flow/i }),
    )

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/sales-flows/$id/edit",
        params: { id: "new-flow" },
        replace: true,
      }),
    )
  })
})
