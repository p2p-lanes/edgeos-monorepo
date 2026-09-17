import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { type SalesFlowPublic, SalesFlowsService } from "@/client"
import { RenameSalesFlowDialog } from "./RenameSalesFlowDialog"

const { showErrorToast } = vi.hoisted(() => ({ showErrorToast: vi.fn() }))

vi.mock("@/client", () => ({
  SalesFlowsService: { updateSalesFlow: vi.fn() },
}))

vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({ showSuccessToast: vi.fn(), showErrorToast }),
}))

const flow = {
  id: "flow-1",
  name: "General admission",
  slug: "general",
  type: "direct",
} as SalesFlowPublic

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(queryClient, "invalidateQueries")
  render(
    <QueryClientProvider client={queryClient}>
      <RenameSalesFlowDialog flow={flow} />
    </QueryClientProvider>,
  )
  return { user: userEvent.setup(), invalidate }
}

describe("Renaming a sales flow", () => {
  beforeEach(() => vi.resetAllMocks())

  it("saves only the trimmed name and refreshes sales flow queries", async () => {
    vi.mocked(SalesFlowsService.updateSalesFlow).mockResolvedValue({
      ...flow,
      name: "Community tickets",
    })
    const { user, invalidate } = renderDialog()
    await user.click(
      screen.getByRole("button", { name: `Rename ${flow.name}` }),
    )
    const input = screen.getByRole("textbox", { name: "Name" })
    expect(input).toHaveValue(flow.name)
    await user.clear(input)
    await user.type(input, "  Community tickets  ")
    await user.click(screen.getByRole("button", { name: "Save name" }))

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    )
    expect(SalesFlowsService.updateSalesFlow).toHaveBeenCalledExactlyOnceWith({
      flowId: flow.id,
      requestBody: { name: "Community tickets" },
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["sales-flows"] })
  })

  it("rejects blank names and discards changes when cancelled", async () => {
    const { user } = renderDialog()
    const trigger = screen.getByRole("button", { name: `Rename ${flow.name}` })
    await user.click(trigger)
    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled()
    const input = screen.getByRole("textbox", { name: "Name" })
    await user.clear(input)
    await user.type(input, "   ")
    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled()
    await user.type(input, "Draft name")
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    await user.click(trigger)

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(flow.name)
    expect(SalesFlowsService.updateSalesFlow).not.toHaveBeenCalled()
  })

  it("keeps the draft available for retry when saving fails", async () => {
    vi.mocked(SalesFlowsService.updateSalesFlow).mockRejectedValue({
      body: { detail: "Unable to update this sales flow" },
    })
    const { user, invalidate } = renderDialog()
    await user.click(
      screen.getByRole("button", { name: `Rename ${flow.name}` }),
    )
    const input = screen.getByRole("textbox", { name: "Name" })
    await user.clear(input)
    await user.type(input, "Community tickets")
    await user.click(screen.getByRole("button", { name: "Save name" }))

    await waitFor(() =>
      expect(showErrorToast).toHaveBeenCalledWith(
        "Unable to update this sales flow",
      ),
    )
    expect(input).toHaveValue("Community tickets")
    expect(screen.getByRole("button", { name: "Save name" })).toBeEnabled()
    expect(invalidate).not.toHaveBeenCalled()
  })
})
