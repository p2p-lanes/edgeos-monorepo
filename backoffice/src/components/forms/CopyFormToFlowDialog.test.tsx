/**
 * Behavioral test for CopyFormToFlowDialog (task 14.4). Disclosed as
 * approval-style, per the established SalesFlowForm.override.test.tsx
 * precedent for JSX composition.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  FormFieldsService: {
    copyFormToFlow: vi.fn(),
  },
  SalesFlowsService: {
    listSalesFlows: vi.fn(),
  },
}))

vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}))

import { FormFieldsService, SalesFlowsService } from "@/client"
import { CopyFormToFlowDialog } from "./CopyFormToFlowDialog"

const mockListSalesFlows = vi.mocked(SalesFlowsService.listSalesFlows)
const mockCopyFormToFlow = vi.mocked(FormFieldsService.copyFormToFlow)

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe("CopyFormToFlowDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListSalesFlows.mockResolvedValue({
      results: [
        { id: "flow-2", name: "Application Flow", type: "application" },
        { id: "flow-3", name: "Upsale Flow", type: "upsale" },
        {
          id: "flow-1",
          name: "Attendee",
          type: "application",
          is_default: true,
        },
      ],
      paging: { limit: 100, offset: 0, total: 2 },
    } as never)
    mockCopyFormToFlow.mockResolvedValue({
      sections: 1,
      base_fields: 2,
      fields: 3,
    })
  })

  it("offers only same-type sources and excludes the target itself", async () => {
    render(
      <Wrapper>
        <CopyFormToFlowDialog
          popupId="popup-1"
          targetFlowId="flow-1"
          targetFlowType="application"
        />
      </Wrapper>,
    )
    await userEvent.click(
      screen.getByRole("button", { name: /copy form from/i }),
    )
    await userEvent.click(screen.getByRole("combobox"))

    expect(await screen.findByText("Application Flow")).toBeInTheDocument()
    expect(screen.queryByText("Upsale Flow")).not.toBeInTheDocument()
    expect(screen.queryByText("Attendee")).not.toBeInTheDocument()
  })

  it("defaults to the event's shared form and copies on confirm", async () => {
    render(
      <Wrapper>
        <CopyFormToFlowDialog
          popupId="popup-1"
          targetFlowId="flow-1"
          targetFlowType="application"
        />
      </Wrapper>,
    )
    await userEvent.click(
      screen.getByRole("button", { name: /copy form from/i }),
    )
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^copy$/i })).toBeEnabled(),
    )
    await userEvent.click(screen.getByRole("button", { name: /^copy$/i }))

    expect(mockCopyFormToFlow).toHaveBeenCalledWith({
      targetFlowId: "flow-1",
      requestBody: { source_flow_id: null },
    })
  })
})
