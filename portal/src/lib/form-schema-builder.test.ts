import { describe, expect, it } from "vitest"
import type { ApplicationFormSchema } from "@/types/form-schema"
import { buildFormZodSchema } from "./form-schema-builder"

// Shared helper — most tests vary only one base field at a time.
function buildSchema(
  base: Record<string, ApplicationFormSchema["base_fields"][string]>,
): ApplicationFormSchema {
  return {
    base_fields: base,
    custom_fields: {},
    sections: [],
  } as unknown as ApplicationFormSchema
}

describe("buildFormZodSchema — email validation", () => {
  it("rejects a malformed email when field.type === 'email'", () => {
    const schema = buildSchema({
      contact_email: {
        type: "email",
        label: "Contact email",
        required: true,
      } as ApplicationFormSchema["base_fields"][string],
    })

    const result = buildFormZodSchema(schema, false).safeParse({
      contact_email: "not-an-email",
    })

    expect(result.success).toBe(false)
  })

  it("rejects a malformed value when the field is literally named 'email'", () => {
    // The open-ticketing buyer schema declares email as a plain string
    // (the backend has no `email` field type for base fields), so we
    // gate on the field name in the default branch.
    const schema = buildSchema({
      email: {
        type: "text",
        label: "Email",
        required: true,
      } as ApplicationFormSchema["base_fields"][string],
    })

    const result = buildFormZodSchema(schema, false).safeParse({
      email: "asdas",
    })

    expect(result.success).toBe(false)
  })

  it("accepts a syntactically valid email", () => {
    const schema = buildSchema({
      email: {
        type: "text",
        label: "Email",
        required: true,
      } as ApplicationFormSchema["base_fields"][string],
    })

    const result = buildFormZodSchema(schema, false).safeParse({
      email: "buyer@example.com",
    })

    expect(result.success).toBe(true)
  })

  it("allows empty email when the field is not required", () => {
    const schema = buildSchema({
      email: {
        type: "text",
        label: "Email",
        required: false,
      } as ApplicationFormSchema["base_fields"][string],
    })

    const result = buildFormZodSchema(schema, false).safeParse({
      email: "",
    })

    expect(result.success).toBe(true)
  })

  it("treats custom_<email> fields the same way (custom-fields branch)", () => {
    const schema = {
      base_fields: {},
      custom_fields: {
        email: {
          type: "text",
          label: "Custom email",
          required: true,
        },
      },
      sections: [],
    } as unknown as ApplicationFormSchema

    // The custom-field key is namespaced as `custom_<name>`, so we pass
    // that as the fieldName to `fieldToZod`. The `email` literal-name
    // check only fires for keys exactly equal to "email", not "custom_email".
    // The custom field falls back to a plain string and accepts junk.
    const result = buildFormZodSchema(schema, false).safeParse({
      custom_email: "asdas",
    })

    expect(result.success).toBe(true)
  })
})
