/**
 * Amanita skin — "Tus Datos" buyer step.
 *
 * The step renders whatever the popup's buyer form declares, the same source
 * the default checkout reads. It used to hardcode four inputs and ignore the
 * schema entirely, which meant an organizer-configured field silently never
 * appeared — and a REQUIRED one wedged the purchase behind a 422 the shopper
 * had no input to fix. These tests pin the schema-driven contract.
 *
 * No jest-dom in this project — assertions use getByText/getByLabelText and
 * toBeTruthy().
 */
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ApplicationFormSchema } from "@/types/form-schema"
import AmanitaBuyerStep from "./AmanitaBuyerStep"

const setBuyerField = vi.fn()
let buyerValues: Record<string, unknown> = {}
let buyerErrors: Record<string, string> = {}
let forcedBuyerFieldsTouched: Set<string> = new Set()
let invalidFields: string[] = []
let buyerFormSchema: ApplicationFormSchema | null = null

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    buyerValues,
    buyerErrors,
    setBuyerField,
    forcedBuyerFieldsTouched,
    buyerFormSchema,
    getBuyerInvalidFields: () => invalidFields,
  }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

function schema(
  base: Record<string, unknown> = {},
  custom: Record<string, unknown> = {},
): ApplicationFormSchema {
  return {
    base_fields: base,
    custom_fields: custom,
    sections: [],
  } as unknown as ApplicationFormSchema
}

const EMAIL_FIELD = {
  type: "email",
  label: "Email",
  required: true,
  target: "human",
  position: 0,
}

describe("AmanitaBuyerStep — schema-driven rendering", () => {
  beforeEach(() => {
    setBuyerField.mockClear()
    buyerValues = {}
    buyerErrors = {}
    forcedBuyerFieldsTouched = new Set()
    invalidFields = []
    buyerFormSchema = schema({ email: EMAIL_FIELD })
  })

  it("renders a base field declared by the schema", () => {
    render(<AmanitaBuyerStep />)
    expect(screen.getByLabelText("Email")).toBeTruthy()
  })

  // The whole point of the rewrite: an organizer adds a field in the form
  // builder and it shows up on the skin. Before, it never rendered — and if
  // required, the backend rejected the purchase with a 422 nobody could clear.
  it("renders an organizer's custom field and writes it under the custom_ prefix", () => {
    buyerFormSchema = schema(
      { email: EMAIL_FIELD },
      {
        dietary: {
          type: "text",
          label: "Dietary restrictions",
          required: false,
          position: 0,
        },
      },
    )
    render(<AmanitaBuyerStep />)

    fireEvent.change(screen.getByLabelText("Dietary restrictions"), {
      target: { value: "vegan" },
    })
    expect(setBuyerField).toHaveBeenCalledWith("custom_dietary", "vegan")
  })

  // A `number` field rendered as `type="text"` looks fine and is wrong: no
  // numeric keypad on mobile, no browser validation.
  it.each([
    ["number", "number"],
    ["date", "date"],
    ["url", "url"],
    ["text", "text"],
  ])("renders a %s field as input[type=%s]", (schemaType, domType) => {
    buyerFormSchema = schema(
      { email: EMAIL_FIELD },
      {
        thing: {
          type: schemaType,
          label: "Thing",
          required: false,
          position: 0,
        },
      },
    )
    render(<AmanitaBuyerStep />)
    expect((screen.getByLabelText("Thing") as HTMLInputElement).type).toBe(
      domType,
    )
  })

  it("renders a select field's options from the schema", () => {
    buyerFormSchema = schema(
      { email: EMAIL_FIELD },
      {
        size: {
          type: "select",
          label: "Shirt size",
          required: false,
          position: 0,
          options: ["S", "M", "L"],
        },
      },
    )
    render(<AmanitaBuyerStep />)
    expect(screen.getByText("M")).toBeTruthy()
  })

  describe("phone fields", () => {
    beforeEach(() => {
      buyerFormSchema = schema(
        { email: EMAIL_FIELD },
        {
          whatsapp: {
            type: "phone",
            label: "WhatsApp",
            required: true,
            position: 0,
          },
        },
      )
    })

    // The country list stays TEXT ("AR +54") — flag emojis don't render on
    // Chrome/Windows, a known repo gotcha.
    it("renders the country select as plain text, never emoji", () => {
      const { container } = render(<AmanitaBuyerStep />)
      expect(screen.getByText("AR +54")).toBeTruthy()
      expect(screen.getByText("US +1")).toBeTruthy()
      expect(container.textContent).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u)
    })

    // One E.164 string, matching what PhoneInputForm stores on the default
    // skin. Two skins must not disagree about the shape of the same answer.
    it("combines country and number into a single E.164 value", () => {
      render(<AmanitaBuyerStep />)
      fireEvent.change(screen.getByLabelText("WhatsApp"), {
        target: { value: "1122334455" },
      })
      expect(setBuyerField).toHaveBeenCalledWith(
        "custom_whatsapp",
        "+541122334455",
      )
    })

    it("splits a stored E.164 value back into country and number", () => {
      buyerValues = { custom_whatsapp: "+56987654321" }
      render(<AmanitaBuyerStep />)

      const select = screen.getByLabelText(
        "checkout.amanita.whatsapp_country_aria",
      ) as HTMLSelectElement
      expect(select.value).toBe("CL")
      expect(
        (screen.getByLabelText("WhatsApp") as HTMLInputElement).value,
      ).toBe("987654321")
    })

    it("rewrites the dial prefix when the country changes, keeping the number", () => {
      buyerValues = { custom_whatsapp: "+541122334455" }
      render(<AmanitaBuyerStep />)

      fireEvent.change(
        screen.getByLabelText("checkout.amanita.whatsapp_country_aria"),
        { target: { value: "UY" } },
      )
      expect(setBuyerField).toHaveBeenCalledWith(
        "custom_whatsapp",
        "+5981122334455",
      )
    })
  })

  describe("errors", () => {
    it("renders a provider error inline", () => {
      buyerErrors = { email: "Revisá el formato del email" }
      render(<AmanitaBuyerStep />)
      expect(screen.getByText("Revisá el formato del email")).toBeTruthy()
    })

    // The funnel bounces a shopper here for fields they never focused, so
    // blur state alone would leave the step looking pristine on arrival.
    it("shows errors for fields the funnel forced open, without any blur", () => {
      forcedBuyerFieldsTouched = new Set(["email"])
      invalidFields = ["email"]
      render(<AmanitaBuyerStep />)
      expect(screen.getByText("checkout.field_required")).toBeTruthy()
    })

    it("stays pristine when nothing has been touched or forced", () => {
      invalidFields = ["email"]
      render(<AmanitaBuyerStep />)
      expect(screen.queryByText("checkout.field_required")).toBeNull()
    })
  })

  it("renders nothing but survives when the schema has not loaded yet", () => {
    buyerFormSchema = null
    expect(() => render(<AmanitaBuyerStep />)).not.toThrow()
  })
})
