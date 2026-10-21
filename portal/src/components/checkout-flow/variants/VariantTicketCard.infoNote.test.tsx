/**
 * The product info note in VariantTicketCard's rows (SIM-37): both the
 * signed-in pass_system row and the open-checkout row show the icon next to
 * the product name, and opening it never adds the product or changes its
 * quantity.
 */
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  TicketRowVM,
  TicketsStepView,
} from "@/hooks/checkout/useTicketsStep"
import type { ProductsPass } from "@/types/Products"
import VariantTicketCard from "./VariantTicketCard"

const toggleRow = vi.fn()
const setRowQuantity = vi.fn()
let view: TicketsStepView

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars && "name" in vars ? `${key}:${vars.name}` : key,
  }),
}))

vi.mock("@/hooks/checkout/useTicketsStep", async () => {
  const actual = await vi.importActual<
    typeof import("@/hooks/checkout/useTicketsStep")
  >("@/hooks/checkout/useTicketsStep")
  return { ...actual, useTicketsStep: () => view }
})

vi.mock("@/components/checkout-flow/shared/TicketRecipientControls", () => ({
  TicketRecipientControls: () => null,
  useTicketRecipientContext: () => ({ sections: [], salesFlowId: null }),
}))

const NOTE = "A passport will be requested for this product."
const LABEL = "checkout.product_info_note_label:Full Pass"

function makeProduct(overrides: Partial<ProductsPass> = {}): ProductsPass {
  return {
    id: "p1",
    tenant_id: "t1",
    popup_id: "pop1",
    name: "Full Pass",
    slug: "full-pass",
    price: 100,
    category: "ticket",
    info_note: NOTE,
    ...overrides,
  } as ProductsPass
}

function makeRow(product: ProductsPass): TicketRowVM {
  return {
    product,
    selected: false,
    purchased: false,
    editedForCredit: false,
    disabled: false,
    saleState: "on_sale",
    quantity: 0,
    maxQuantity: 1,
    // Single-select rows: the row's own button toggles the product.
    usesStepper: false,
    price: product.price,
    comparePrice: null,
  }
}

function baseView(overrides: Partial<TicketsStepView>): TicketsStepView {
  return {
    mode: "simple_quantity",
    isOpenCheckout: true,
    attendees: [],
    sections: [],
    isEditing: false,
    editCredit: 0,
    toggleRow,
    setRowQuantity,
    toggleEditing: vi.fn(),
    ...overrides,
  }
}

describe("VariantTicketCard info note", () => {
  beforeEach(() => {
    toggleRow.mockClear()
    setRowQuantity.mockClear()
  })

  it("open checkout: tapping the icon reveals the note and adds nothing", () => {
    const product = makeProduct()
    view = baseView({
      sections: [{ key: "s", label: "Tickets", rows: [makeRow(product)] }],
    })
    render(
      <VariantTicketCard
        products={[product]}
        stepType="tickets"
        templateConfig={null}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: LABEL }))

    expect(screen.getByText(NOTE)).toBeTruthy()
    expect(toggleRow).not.toHaveBeenCalled()
    expect(setRowQuantity).not.toHaveBeenCalled()
  })

  it("pass system: tapping the icon reveals the note and adds nothing", () => {
    const product = makeProduct()
    view = baseView({
      mode: "pass_system",
      isOpenCheckout: false,
      attendees: [
        {
          id: "a1",
          name: "Ana",
          category: "main",
          category_id: null,
          selectedCount: 0,
          sections: [{ key: "s", label: "Tickets", rows: [makeRow(product)] }],
        },
      ],
    })
    render(
      <VariantTicketCard
        products={[product]}
        stepType="tickets"
        templateConfig={null}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: LABEL }))

    expect(screen.getByText(NOTE)).toBeTruthy()
    expect(toggleRow).not.toHaveBeenCalled()
    expect(setRowQuantity).not.toHaveBeenCalled()
  })

  it("shows no icon for a product without a note", () => {
    const product = makeProduct({ info_note: null })
    view = baseView({
      sections: [{ key: "s", label: "Tickets", rows: [makeRow(product)] }],
    })
    render(
      <VariantTicketCard
        products={[product]}
        stepType="tickets"
        templateConfig={null}
      />,
    )

    expect(screen.getByText("Full Pass")).toBeTruthy()
    expect(screen.queryByRole("button", { name: LABEL })).toBeNull()
  })
})
