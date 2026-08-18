import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { TicketingStepPublic } from "@/client"
import { PopupsService, ProductsService, TicketingStepsService } from "@/client"
import { StepDetailPanel } from "./StepDetailPanel"

vi.mock("@/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/client")>()
  return {
    ...actual,
    TicketingStepsService: {
      getTicketingStep: vi.fn(),
      updateTicketingStep: vi.fn(),
      deleteTicketingStep: vi.fn(),
    },
    PopupsService: {
      getPopup: vi.fn(),
    },
    ProductsService: {
      listProductCategories: vi.fn(),
    },
  }
})

// The panel's dirty-check uses TanStack Router's navigation blocker, which
// needs a full router context we don't otherwise set up here. Stub it as
// "never blocked" — the save round trip under test doesn't touch it.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>()
  return {
    ...actual,
    useBlocker: () => ({ status: "idle" as const }),
  }
})

const baseStep: TicketingStepPublic = {
  id: "step-1",
  tenant_id: "tenant-1",
  popup_id: "popup-1",
  step_type: "buyer",
  title: "Your information",
  order: 0,
  is_enabled: true,
  protected: false,
  template: "buyer-form",
  emoji: null,
}

function renderPanel() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <StepDetailPanel stepId={baseStep.id} onClose={() => {}} />
    </QueryClientProvider>,
  )
}

describe("StepDetailPanel", () => {
  beforeEach(() => {
    vi.mocked(TicketingStepsService.getTicketingStep).mockResolvedValue(
      baseStep,
    )
    vi.mocked(TicketingStepsService.updateTicketingStep).mockResolvedValue(
      baseStep,
    )
    vi.mocked(PopupsService.getPopup).mockResolvedValue({
      id: "popup-1",
      supported_languages: ["en"],
      default_language: "en",
    } as Awaited<ReturnType<typeof PopupsService.getPopup>>)
    vi.mocked(ProductsService.listProductCategories).mockResolvedValue([])
  })

  it("sends the icon picker's slug in the save payload", async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByRole("button", { name: "Step icon" }))
    await user.click(screen.getByRole("button", { name: "Mushroom" }))
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(TicketingStepsService.updateTicketingStep).toHaveBeenCalledWith(
      expect.objectContaining({
        stepId: baseStep.id,
        requestBody: expect.objectContaining({ emoji: "mushroom" }),
      }),
    )
  })
})
