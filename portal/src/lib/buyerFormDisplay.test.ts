import { describe, expect, it } from "vitest"
import type { ApplicationFormSchema } from "@/types/form-schema"
import { buyerFormDisplaySchema } from "./buyerFormDisplay"

const schema: ApplicationFormSchema = {
  base_fields: {
    email: { type: "email", label: "Email", required: true },
    first_name: { type: "text", label: "First name", required: true },
    last_name: { type: "text", label: "Last name", required: true },
    phone: { type: "text", label: "Phone", required: true },
  },
  custom_fields: {
    delivery_location: {
      type: "select",
      label: "Delivery location",
      required: true,
      options: ["Riva Resort", "Circle Coworking"],
    },
  },
  sections: [],
}

describe("buyerFormDisplaySchema", () => {
  it("asks anonymous buyers for all identity fields", () => {
    expect(buyerFormDisplaySchema(schema)).toEqual(schema)
  })
  it("hides known session identity while retaining the full payment schema", () => {
    const display = buyerFormDisplaySchema(schema, {
      email: "buyer@example.com",
      firstName: "Test",
      lastName: "Buyer",
    })
    expect(Object.keys(display.base_fields)).toEqual(["phone"])
    expect(display.custom_fields).toEqual(schema.custom_fields)
    expect(Object.keys(schema.base_fields)).toEqual([
      "email",
      "first_name",
      "last_name",
      "phone",
    ])
  })
  it("still asks for missing or blank account names", () => {
    const display = buyerFormDisplaySchema(schema, {
      email: "buyer@example.com",
      firstName: "Test",
      lastName: "  ",
    })
    expect(Object.keys(display.base_fields)).toEqual(["last_name", "phone"])
  })
})
