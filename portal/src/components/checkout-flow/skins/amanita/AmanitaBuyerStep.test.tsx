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
import type { TicketingStepPublic } from "@/client"
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

  describe("structural field placeholders", () => {
    const NAME_FIELDS = {
      first_name: {
        type: "text",
        label: "Nombre",
        required: true,
        target: "human",
        position: 1,
      },
      last_name: {
        type: "text",
        label: "Apellido",
        required: true,
        target: "human",
        position: 2,
      },
    }

    it("suggests example text in email, first name and last name", () => {
      buyerFormSchema = schema({ email: EMAIL_FIELD, ...NAME_FIELDS })
      render(<AmanitaBuyerStep />)

      expect(
        (screen.getByLabelText("Email") as HTMLInputElement).placeholder,
      ).toBe("checkout.amanita.buyer_placeholder_email")
      expect(
        (screen.getByLabelText("Nombre") as HTMLInputElement).placeholder,
      ).toBe("checkout.amanita.buyer_placeholder_first_name")
      expect(
        (screen.getByLabelText("Apellido") as HTMLInputElement).placeholder,
      ).toBe("checkout.amanita.buyer_placeholder_last_name")
    })

    it("never overrides a placeholder the organizer authored", () => {
      buyerFormSchema = schema({
        email: { ...EMAIL_FIELD, placeholder: "socio@club.com" },
      })
      render(<AmanitaBuyerStep />)

      expect(
        (screen.getByLabelText("Email") as HTMLInputElement).placeholder,
      ).toBe("socio@club.com")
    })

    it("leaves a field the skin knows nothing about without one", () => {
      buyerFormSchema = schema(
        {},
        {
          instagram: {
            type: "text",
            label: "Instagram",
            required: false,
            target: "human",
            position: 0,
          },
        },
      )
      render(<AmanitaBuyerStep />)

      expect(
        (screen.getByLabelText("Instagram") as HTMLInputElement).placeholder,
      ).toBe("")
    })
  })

  describe("section heading", () => {
    // The structural email/first_name/last_name carry no section_id, so
    // getCheckoutSchemaSections parks them in a synthetic "_unsectioned_base"
    // group titled with a hardcoded "Personal information". The buyer step
    // suppresses every section heading, so neither that artifact nor the
    // organizer's own section label ever reaches the card.
    function twoSectionSchema() {
      return {
        base_fields: {
          email: EMAIL_FIELD,
          first_name: {
            type: "text",
            label: "Nombre",
            required: true,
            target: "human",
            position: 1,
          },
          last_name: {
            type: "text",
            label: "Apellido",
            required: true,
            target: "human",
            position: 2,
          },
        },
        custom_fields: {
          dietary: {
            type: "text",
            label: "Dietary",
            required: false,
            section_id: "sec-1",
            position: 0,
          },
        },
        sections: [{ id: "sec-1", label: "Personal Information", order: 0 }],
      } as unknown as ApplicationFormSchema
    }

    // The step already leads with its own title, so the buyer form prints
    // no section heading at all — neither the organizer's own section label
    // nor the synthetic "Personal information" portal artifact.
    it("never prints the organizer's section heading", () => {
      buyerFormSchema = twoSectionSchema()
      render(<AmanitaBuyerStep />)
      expect(screen.queryByText("Personal Information")).toBeNull()
    })

    it("never prints the synthetic 'Personal information' group title", () => {
      buyerFormSchema = twoSectionSchema()
      render(<AmanitaBuyerStep />)
      expect(screen.queryByText("Personal information")).toBeNull()
    })

    it("renders no section heading element", () => {
      buyerFormSchema = twoSectionSchema()
      const { container } = render(<AmanitaBuyerStep />)
      expect(container.querySelectorAll("h3")).toHaveLength(0)
    })
  })

  it("lays first_name and last_name out on one row", () => {
    buyerFormSchema = {
      base_fields: {
        email: EMAIL_FIELD,
        first_name: {
          type: "text",
          label: "Nombre",
          required: true,
          target: "human",
          position: 1,
        },
        last_name: {
          type: "text",
          label: "Apellido",
          required: true,
          target: "human",
          position: 2,
        },
      },
      custom_fields: {},
      sections: [],
    } as unknown as ApplicationFormSchema
    render(<AmanitaBuyerStep />)

    const row = screen.getByTestId("ck-name-row")
    expect(row.contains(screen.getByLabelText("Nombre"))).toBe(true)
    expect(row.contains(screen.getByLabelText("Apellido"))).toBe(true)
    // Email keeps its own full-width row.
    expect(row.contains(screen.getByLabelText("Email"))).toBe(false)
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

  // The stepper hides its generic SectionHeader on this skin, so the step
  // config's copy reaches the shopper through this section's shell or not at
  // all. It used to hardcode the skin's strings: an organizer renamed the step
  // in the backoffice and nothing on screen moved.
  describe("step heading", () => {
    const CONFIG = {
      id: "s1",
      step_type: "buyer",
      title: "Tus Datos",
      description: "Necesitamos saber a quién le emitimos las entradas.",
      watermark: "Paso 2",
      template_config: null,
    } as unknown as TicketingStepPublic

    it("takes title, description and watermark from the step config", () => {
      render(<AmanitaBuyerStep stepConfig={CONFIG} />)
      expect(screen.getByText("Tus Datos")).toBeTruthy()
      expect(
        screen.getByText("Necesitamos saber a quién le emitimos las entradas."),
      ).toBeTruthy()
      expect(screen.getByText("Paso 2")).toBeTruthy()
    })

    it("prefers a template_config kicker over the watermark", () => {
      render(
        <AmanitaBuyerStep
          stepConfig={
            { ...CONFIG, template_config: { kicker: "Casi listo" } } as never
          }
        />,
      )
      expect(screen.getByText("Casi listo")).toBeTruthy()
      expect(screen.queryByText("Paso 2")).toBeNull()
    })

    // An organizer who cleared the description wants no intro — not the
    // skin's opinion of one.
    it("shows no intro when the configured step has no description", () => {
      render(
        <AmanitaBuyerStep
          stepConfig={{ ...CONFIG, description: null } as never}
        />,
      )
      expect(screen.queryByText("checkout.amanita.buyer_intro")).toBeNull()
    })

    it("falls back to the skin's copy when no step is configured", () => {
      render(<AmanitaBuyerStep />)
      expect(screen.getByText("checkout.amanita.buyer_title")).toBeTruthy()
      expect(screen.getByText("checkout.amanita.buyer_kicker")).toBeTruthy()
      expect(screen.getByText("checkout.amanita.buyer_intro")).toBeTruthy()
    })
  })

  it("renders nothing but survives when the schema has not loaded yet", () => {
    buyerFormSchema = null
    expect(() => render(<AmanitaBuyerStep />)).not.toThrow()
  })
})
