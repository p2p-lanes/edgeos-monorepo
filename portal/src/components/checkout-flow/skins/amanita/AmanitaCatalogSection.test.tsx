/**
 * Tests for AmanitaCatalogSection (Task 11).
 *
 * Verifies that:
 * - Products are resolved via useCheckout().getProductsForStep(stepConfig)
 *   (the same call DynamicProductStep.tsx makes) and fed into the REAL
 *   useTicketsStep contract.
 * - Both product labels and prices render from the section VM's rows.
 * - Clicking "+" on a row calls the hook's real setRowQuantity action with
 *   quantity + 1.
 * - A `disabled` row's "+" control is disabled (sold-out / pre-sale, etc.).
 *
 * No jest-dom in this project — assertions use
 * `getByText`/`getByLabelText`/`fireEvent`/`toBeTruthy()`.
 */
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TicketingStepPublic } from "@/client"
import type {
  TicketRowVM,
  TicketSectionVM,
  TicketsStepView,
} from "@/hooks/checkout/useTicketsStep"
import { formatCurrency } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"
import AmanitaCatalogSection from "./AmanitaCatalogSection"

const getProductsForStep = vi.fn()
const toggleRow = vi.fn()
const setRowQuantity = vi.fn()

let ticketsStepView: TicketsStepView

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({ getProductsForStep }),
}))

// Key-as-text, per the other skin tests — but the row controls are told apart
// only by the product name interpolated into their label, so unlike those
// tests this stub has to keep the interpolated values.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${Object.values(vars).join(",")}` : key,
  }),
}))

vi.mock("@/hooks/checkout/useTicketsStep", async () => {
  const actual = await vi.importActual<
    typeof import("@/hooks/checkout/useTicketsStep")
  >("@/hooks/checkout/useTicketsStep")
  return {
    ...actual,
    useTicketsStep: () => ticketsStepView,
  }
})

function makeProduct(overrides: Partial<ProductsPass> = {}): ProductsPass {
  return {
    id: "p1",
    tenant_id: "t1",
    popup_id: "pop1",
    name: "Full Pass",
    slug: "full-pass",
    price: 100,
    category: "tickets",
    ...overrides,
  } as ProductsPass
}

function makeRow(overrides: Partial<TicketRowVM> = {}): TicketRowVM {
  const product = overrides.product ?? makeProduct()
  return {
    product,
    selected: false,
    purchased: false,
    editedForCredit: false,
    disabled: false,
    saleState: "on_sale",
    quantity: 0,
    maxQuantity: 5,
    usesStepper: true,
    price: product.price,
    comparePrice: null,
    ...overrides,
  }
}

const stepConfig = {
  id: "step-1",
  step_type: "tickets",
  title: "Tickets",
  description: "Elegí tu experiencia",
  order: 0,
  product_category: "tickets",
  template: "ticket-select",
  template_config: null,
} as unknown as TicketingStepPublic

describe("AmanitaCatalogSection", () => {
  let product1: ProductsPass
  let product2: ProductsPass
  let row1: TicketRowVM
  let row2: TicketRowVM
  let section: TicketSectionVM

  beforeEach(() => {
    toggleRow.mockClear()
    setRowQuantity.mockClear()

    product1 = makeProduct({ id: "p1", name: "Full Pass", price: 100 })
    product2 = makeProduct({ id: "p2", name: "Day Pass", price: 50 })
    row1 = makeRow({ product: product1, quantity: 0, disabled: false })
    row2 = makeRow({ product: product2, quantity: 0, disabled: true })
    section = { key: "tickets", label: "Tickets", rows: [row1, row2] }

    getProductsForStep.mockReturnValue([product1, product2])

    ticketsStepView = {
      mode: "simple_quantity",
      isOpenCheckout: true,
      attendees: [],
      sections: [section],
      isEditing: false,
      editCredit: 0,
      toggleRow,
      setRowQuantity,
      toggleEditing: vi.fn(),
    }
  })

  it("resolves products via getProductsForStep(stepConfig)", () => {
    render(<AmanitaCatalogSection stepConfig={stepConfig} />)
    expect(getProductsForStep).toHaveBeenCalledWith(stepConfig)
  })

  it("renders both product labels and prices from the section VM rows", () => {
    render(<AmanitaCatalogSection stepConfig={stepConfig} />)
    expect(screen.getByText("Full Pass")).toBeTruthy()
    expect(screen.getByText("Day Pass")).toBeTruthy()
    expect(screen.getByText(formatCurrency(100))).toBeTruthy()
    expect(screen.getByText(formatCurrency(50))).toBeTruthy()
  })

  it('clicking "+" on a row calls setRowQuantity with quantity + 1', () => {
    render(<AmanitaCatalogSection stepConfig={stepConfig} />)
    const plusButton = screen.getByLabelText(
      "checkout.amanita.catalog_add_aria:Full Pass",
    )
    fireEvent.click(plusButton)
    expect(setRowQuantity).toHaveBeenCalledWith("", product1, 1)
  })

  it('disables the "+" control on a disabled row', () => {
    render(<AmanitaCatalogSection stepConfig={stepConfig} />)
    const plusButton = screen.getByLabelText(
      "checkout.amanita.catalog_add_aria:Day Pass",
    ) as HTMLButtonElement
    expect(plusButton.disabled).toBe(true)
    fireEvent.click(plusButton)
    expect(setRowQuantity).not.toHaveBeenCalled()
  })
})
