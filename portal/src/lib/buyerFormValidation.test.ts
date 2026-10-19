import { describe, expect, it } from "vitest"
import { buildFormZodSchema } from "@/lib/form-schema-builder"
import type { ApplicationFormSchema } from "@/types/form-schema"
import { buyerFormValidationSchema } from "./buyerFormValidation"

const schema: ApplicationFormSchema = {
  base_fields: {
    email: { type: "email", label: "Email", required: true },
    first_name: { type: "text", label: "First name", required: true },
    last_name: { type: "text", label: "Last name", required: true },
    phone: { type: "text", label: "Phone", required: true },
  },
  custom_fields: {
    location: { type: "text", label: "Location", required: true },
  },
  sections: [],
}
const identity = {
  email: "buyer@example.com",
  first_name: "Test",
  last_name: "Buyer",
}

describe("buyerFormValidationSchema", () => {
  it("ignores required form questions on a disabled step without changing the form", () => {
    const validation = buyerFormValidationSchema(schema, false)!
    expect(
      buildFormZodSchema(validation, false).safeParse(identity).success,
    ).toBe(true)
    expect(schema.custom_fields.location.required).toBe(true)
    expect(schema.base_fields.phone.required).toBe(true)
  })
  it("keeps payment identity required even when the buyer step is disabled", () => {
    const validation = buyerFormValidationSchema(schema, false)!
    expect(buildFormZodSchema(validation, false).safeParse({}).success).toBe(
      false,
    )
  })
  it("requires the questions again immediately when the step is enabled", () => {
    const validation = buyerFormValidationSchema(schema, true)!
    expect(
      buildFormZodSchema(validation, false).safeParse(identity).success,
    ).toBe(false)
    expect(
      buildFormZodSchema(validation, false).safeParse({
        ...identity,
        phone: "123",
        custom_location: "Test location",
      }).success,
    ).toBe(true)
  })
})
