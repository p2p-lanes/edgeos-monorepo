import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ProductPublic, TicketingStepPublic } from "@/client"
import {
  AttendeeCategoriesService,
  FormFieldsService,
  PopupsService,
  ProductsService,
  TicketingStepsService,
} from "@/client"
import { StepDetailPanel } from "./StepDetailPanel"

vi.mock("@/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/client")>()
  return {
    ...actual,
    EventSettingsService: {
      getEventSettings: vi.fn().mockResolvedValue({ timezone: "Asia/Kolkata" }),
    },
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
      listProducts: vi.fn(),
    },
    AttendeeCategoriesService: {
      listSalesFlowAttendeeCategories: vi.fn(),
    },
    FormFieldsService: {
      listFormFields: vi.fn(),
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
  sales_flow_id: "flow-1",
  step_type: "buyer",
  title: "Your information",
  order: 0,
  is_enabled: true,
  protected: false,
  template: "buyer-form",
  emoji: null,
}

const products: ProductPublic[] = [
  ["product-access", "Access Pass"],
  ["product-participant", "Participant Meal"],
  ["product-order", "Order Merchandise"],
].map(([id, name]) => ({
  id,
  tenant_id: "tenant-1",
  popup_id: "popup-1",
  name,
  slug: id,
  price: "10.00",
  category: "mixed",
  is_active: true,
}))

function renderPanel(step = baseStep) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <StepDetailPanel stepId={step.id} onClose={() => {}} />
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
    vi.mocked(ProductsService.listProducts).mockResolvedValue({
      results: products,
      paging: { limit: 200, offset: 0, total: products.length },
    })
    vi.mocked(
      AttendeeCategoriesService.listSalesFlowAttendeeCategories,
    ).mockResolvedValue({
      results: [],
      paging: { limit: 100, offset: 0, total: 0 },
    })
    vi.mocked(FormFieldsService.listFormFields).mockResolvedValue({
      results: [],
      paging: { limit: 100, offset: 0, total: 0 },
    })
  })

  it("uses the popup time zone for the deadline without a separate zone setting", async () => {
    const user = userEvent.setup()
    vi.mocked(TicketingStepsService.getTicketingStep).mockResolvedValue({
      ...baseStep,
      allow_response_editing: true,
      response_edit_deadline: "2026-10-23T06:30:00Z",
    })
    renderPanel()
    expect(
      await screen.findByText("Uses the gathering time zone: Asia/Kolkata."),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText("Time zone (IANA)")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Deadline date")).toHaveValue("2026-10-23")
    expect(screen.getByLabelText("Deadline time")).toHaveValue("12:00")
    await user.clear(screen.getByLabelText("Deadline time"))
    await user.type(screen.getByLabelText("Deadline time"), "13:00")
    await user.click(screen.getByRole("button", { name: "Save" }))
    const payload = vi.mocked(TicketingStepsService.updateTicketingStep).mock
      .lastCall?.[0].requestBody
    expect(payload?.response_edit_deadline).toBe("2026-10-23T07:30:00.000Z")
    expect(payload).not.toHaveProperty("response_edit_timezone")
  })

  it("validates typed dates and retains the calendar option", async () => {
    const user = userEvent.setup()
    vi.mocked(TicketingStepsService.getTicketingStep).mockResolvedValue({
      ...baseStep,
      allow_response_editing: true,
      response_edit_deadline: "2026-10-23T06:30:00Z",
    })
    renderPanel()
    await user.clear(await screen.findByLabelText("Deadline date"))
    await user.type(screen.getByLabelText("Deadline date"), "2026-02-30")
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    await user.clear(screen.getByLabelText("Deadline date"))
    await user.type(screen.getByLabelText("Deadline date"), "2026-10-24")
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled()
    await user.click(
      screen.getByRole("button", { name: "Choose deadline date" }),
    )
    expect(await screen.findByRole("grid")).toBeInTheDocument()
  })

  it("requires both a date and a time before saving an enabled policy", async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(
      await screen.findByRole("switch", {
        name: "Allow editing after purchase",
      }),
    )
    await user.type(screen.getByLabelText("Deadline time"), "13:00")
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose a deadline date and time.",
    )
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    await user.click(
      screen.getByRole("switch", { name: "Allow editing after purchase" }),
    )
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(TicketingStepsService.updateTicketingStep).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          allow_response_editing: false,
          response_edit_deadline: null,
        }),
      }),
    )
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

  it.each([
    "ticket-card",
    "ticket-select",
  ])("%s offers and preserves access, participant, and order products", async (template) => {
    const user = userEvent.setup()
    const step: TicketingStepPublic = {
      ...baseStep,
      id: `step-${template}`,
      step_type: "cart",
      title: `${template} configuration`,
      template,
      product_category: "mixed",
      template_config: {
        sections: [
          {
            key: "all-products",
            label: "All products",
            order: 0,
            product_ids: [],
          },
        ],
      },
    }
    vi.mocked(TicketingStepsService.getTicketingStep).mockResolvedValue(step)

    renderPanel(step)

    await user.click(
      await screen.findByRole("button", { name: "Assign product" }),
    )
    for (const product of products) {
      await user.click(
        screen.getByRole("button", { name: new RegExp(product.name) }),
      )
    }
    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(TicketingStepsService.updateTicketingStep).toHaveBeenCalledWith(
        expect.objectContaining({
          stepId: step.id,
          requestBody: expect.objectContaining({
            template_config: expect.objectContaining({
              sections: [
                expect.objectContaining({
                  product_ids: products.map((product) => product.id),
                }),
              ],
            }),
          }),
        }),
      ),
    )
  })

  it("loads ticket-select attendee categories from the current sales flow", async () => {
    const step: TicketingStepPublic = {
      ...baseStep,
      step_type: "cart",
      template: "ticket-select",
      template_config: { sections: [] },
    }
    vi.mocked(TicketingStepsService.getTicketingStep).mockResolvedValue(step)

    renderPanel(step)

    await waitFor(() =>
      expect(
        AttendeeCategoriesService.listSalesFlowAttendeeCategories,
      ).toHaveBeenCalledWith({ flowId: "flow-1" }),
    )
  })
})
