import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import PassSelectionSection from "./PassSelectionSection"

const getRelevantApplication = vi.hoisted(() => vi.fn())

vi.mock("@/components/checkout-flow/shared/AddAttendeeButtons", () => ({
  default: ({ salesFlowId }: { salesFlowId?: string | null }) => (
    <div data-testid="recipient-toolbar">{salesFlowId}</div>
  ),
}))
vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({ getRelevantApplication }),
}))
vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    editCredit: 0,
    editPassesEnabled: false,
    checkoutMode: "pass_system",
    salesFlowId: "flow-second",
  }),
}))
vi.mock("@/providers/passesProvider", () => ({
  usePassesProvider: () => ({
    attendeePasses: [],
    toggleProduct: vi.fn(),
    isEditing: false,
    toggleEditing: vi.fn(),
  }),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe("PassSelectionSection recipient toolbar", () => {
  it("uses the selected flow to resolve an application when several exist", () => {
    getRelevantApplication.mockImplementation((salesFlowId?: string) =>
      salesFlowId === "flow-second"
        ? { id: "application-second", sales_flow_id: "flow-second" }
        : null,
    )

    render(<PassSelectionSection />)

    expect(getRelevantApplication).toHaveBeenCalledWith("flow-second")
    expect(screen.getByTestId("recipient-toolbar").textContent).toBe(
      "flow-second",
    )
  })
})
