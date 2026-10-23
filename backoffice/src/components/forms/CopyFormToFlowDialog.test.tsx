/**
 * Behavioral test for CopyFormToFlowDialog (task 14.4). Disclosed as
 * approval-style, per the established SalesFlowForm.override.test.tsx
 * precedent for JSX composition.
 */
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  FormFieldsService: {
    copyFormToFlow: vi.fn(),
  },
}))

vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}))

import { FormFieldsService, type SalesFlowPublic } from "@/client"
import { CopyFormToFlowDialog } from "./CopyFormToFlowDialog"

const mockCopyFormToFlow = vi.mocked(FormFieldsService.copyFormToFlow)
const refetchTargetFields = vi.fn()
const refetchTargetSections = vi.fn()

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = makeQueryClient()
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function ActiveTargetQueries() {
  useQuery({
    queryKey: ["form-fields", "popup-1", "flow-1"],
    queryFn: refetchTargetFields,
    initialData: "stale fields",
    staleTime: Number.POSITIVE_INFINITY,
  })
  useQuery({
    queryKey: ["form-sections", "popup-1", "flow-1"],
    queryFn: refetchTargetSections,
    initialData: "stale sections",
    staleTime: Number.POSITIVE_INFINITY,
  })
  return null
}

describe("CopyFormToFlowDialog", () => {
  const flows = [
    { id: "flow-2", name: "Application Flow", type: "application" },
    { id: "flow-3", name: "Upsale Flow", type: "upsale" },
    {
      id: "flow-1",
      name: "Attendee",
      type: "application",
      is_default: true,
    },
  ] as SalesFlowPublic[]

  beforeEach(() => {
    vi.clearAllMocks()
    refetchTargetFields.mockResolvedValue("fresh fields")
    refetchTargetSections.mockResolvedValue("fresh sections")
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
          flows={flows}
        />
      </Wrapper>,
    )
    await userEvent.click(
      screen.getByRole("button", { name: /copy form from/i }),
    )
    await userEvent.click(screen.getByRole("combobox"))

    expect(
      await screen.findByRole("option", { name: "Application Flow" }),
    ).toBeInTheDocument()
    expect(screen.queryByText("Upsale Flow")).not.toBeInTheDocument()
    expect(screen.queryByText("Attendee")).not.toBeInTheDocument()
  })

  it("does not offer copy when the only flow is the target", () => {
    render(
      <Wrapper>
        <CopyFormToFlowDialog
          popupId="popup-1"
          targetFlowId="flow-1"
          targetFlowType="application"
          flows={[flows[2]]}
        />
      </Wrapper>,
    )
    expect(
      screen.queryByRole("button", { name: /copy form from/i }),
    ).not.toBeInTheDocument()
    expect(mockCopyFormToFlow).not.toHaveBeenCalled()
  })

  it("copies from another flow and invalidates target queries", async () => {
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <ActiveTargetQueries />
        <CopyFormToFlowDialog
          popupId="popup-1"
          targetFlowId="flow-1"
          targetFlowType="application"
          flows={flows}
        />
      </QueryClientProvider>,
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
      requestBody: { source_flow_id: "flow-2" },
    })
    await waitFor(() => expect(refetchTargetFields).toHaveBeenCalledOnce())
    expect(refetchTargetSections).toHaveBeenCalledOnce()
  })

  it("labels a distinct default flow as primary and allows copying from it", async () => {
    render(
      <Wrapper>
        <CopyFormToFlowDialog
          popupId="popup-1"
          targetFlowId="flow-2"
          targetFlowType="application"
          flows={flows}
        />
      </Wrapper>,
    )
    await userEvent.click(
      screen.getByRole("button", { name: /copy form from/i }),
    )
    expect(screen.getByRole("combobox")).toHaveTextContent(
      "Attendee (primary flow)",
    )
    await userEvent.click(screen.getByRole("button", { name: /^copy$/i }))
    expect(mockCopyFormToFlow).toHaveBeenCalledWith({
      targetFlowId: "flow-2",
      requestBody: { source_flow_id: "flow-1" },
    })
  })
})
