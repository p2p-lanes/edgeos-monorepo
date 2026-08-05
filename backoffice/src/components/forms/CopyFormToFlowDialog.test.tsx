/**
 * Behavioral test for CopyFormToFlowDialog (task 14.4). Disclosed as
 * approval-style, per the established SalesFlowForm.override.test.tsx
 * precedent for JSX composition.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
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
        { id: "flow-2", name: "Upsale Flow" },
        { id: "flow-1", name: "Default Flow" },
      ],
      paging: { limit: 100, offset: 0, total: 2 },
    } as never)
    mockCopyFormToFlow.mockResolvedValue({
      sections: 1,
      base_fields: 2,
      fields: 3,
    })
  })

  it("excludes the target flow itself from the source options", async () => {
    render(
      <Wrapper>
        <CopyFormToFlowDialog popupId="popup-1" targetFlowId="flow-1" />
      </Wrapper>,
    )
    await userEvent.click(
      screen.getByRole("button", { name: /copy form from/i }),
    )
    await userEvent.click(screen.getByRole("combobox"))

    expect(await screen.findByText("Upsale Flow")).toBeInTheDocument()
    expect(screen.queryByText("Default Flow")).not.toBeInTheDocument()
  })

  it("defaults to the event's shared form and copies on confirm", async () => {
    render(
      <Wrapper>
        <CopyFormToFlowDialog popupId="popup-1" targetFlowId="flow-1" />
      </Wrapper>,
    )
    await userEvent.click(
      screen.getByRole("button", { name: /copy form from/i }),
    )
    await userEvent.click(screen.getByRole("button", { name: /^copy$/i }))

    expect(mockCopyFormToFlow).toHaveBeenCalledWith({
      targetFlowId: "flow-1",
      requestBody: { source_flow_id: null },
    })
  })
})
