/**
 * Amanita skin — "Tus Datos" buyer step (Task 7).
 *
 * Confirms: WhatsApp number input writes to the real checkout provider via
 * `setBuyerField("phone", …)`; the country select renders plain TEXT like
 * "AR +54" (no flag emoji glyphs — Chrome/Windows doesn't render those); a
 * `buyerErrors.email` value from the provider renders inline. No jest-dom in
 * this project — assertions use `getByText`/`getByLabelText`/`toBeTruthy()`.
 */
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import AmanitaBuyerStep from "./AmanitaBuyerStep"

const setBuyerField = vi.fn()
let buyerValues: Record<string, unknown> = {}
let buyerErrors: Record<string, string> = {}
// Fields the funnel forced open after a bounce, unioned into local blur state.
let forcedBuyerFieldsTouched: Set<string> = new Set()

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    buyerValues,
    buyerErrors,
    setBuyerField,
    forcedBuyerFieldsTouched,
  }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

describe("AmanitaBuyerStep", () => {
  beforeEach(() => {
    setBuyerField.mockClear()
    buyerValues = {}
    buyerErrors = {}
    forcedBuyerFieldsTouched = new Set()
  })

  // The funnel bounces a shopper here for fields they never focused, so blur
  // state alone would leave the step looking pristine on arrival.
  it("shows errors for fields the funnel forced open, without any blur", () => {
    forcedBuyerFieldsTouched = new Set(["email", "phone"])
    render(<AmanitaBuyerStep />)

    expect(screen.getByText("checkout.amanita.email_required")).toBeTruthy()
    expect(screen.getByText("checkout.amanita.phone_required")).toBeTruthy()
  })

  it("stays pristine when nothing has been touched or forced", () => {
    render(<AmanitaBuyerStep />)

    expect(screen.queryByText("checkout.amanita.email_required")).toBeNull()
  })

  it("calls setBuyerField('phone', …) when typing the WhatsApp number", () => {
    render(<AmanitaBuyerStep />)
    fireEvent.change(screen.getByLabelText("checkout.amanita.whatsapp_label"), {
      target: { value: "1122334455" },
    })
    expect(setBuyerField).toHaveBeenCalledWith("phone", "1122334455")
  })

  it("renders the WhatsApp country select as plain text, no emoji", () => {
    render(<AmanitaBuyerStep />)
    expect(screen.getByText("AR +54")).toBeTruthy()
    expect(screen.getByText("US +1")).toBeTruthy()
  })

  it("renders a buyerErrors.email value inline", () => {
    buyerErrors = { email: "Revisá el formato del email" }
    render(<AmanitaBuyerStep />)
    expect(screen.getByText("Revisá el formato del email")).toBeTruthy()
  })

  it("preselects phone_country from buyerValues when already set, no emoji glyphs anywhere", () => {
    buyerValues = { phone_country: "CL" }
    const { container } = render(<AmanitaBuyerStep />)
    const select = screen.getByLabelText(
      "checkout.amanita.whatsapp_country_aria",
    ) as HTMLSelectElement
    expect(select.value).toBe("CL")
    expect(container.textContent).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u)
  })
})
