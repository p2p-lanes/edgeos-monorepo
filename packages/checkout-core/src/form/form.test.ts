import { describe, expect, it } from "vitest"
import type { ApplicationFormSchema, FormFieldSchema } from "../types/form"
import {
  invalidFields,
  isBuyerComplete,
  stripCustomPrefix,
  toBuyerInfo,
  validateBuyerValues,
} from "./buyer"
import { buildFormZodSchema } from "./schema"

function field(over: Partial<FormFieldSchema> & { type: FormFieldSchema["type"] }): FormFieldSchema {
  return { label: over.type, required: false, ...over }
}

function schema(over: Partial<ApplicationFormSchema>): ApplicationFormSchema {
  return { base_fields: {}, custom_fields: {}, ...over }
}

describe("buildFormZodSchema", () => {
  it("enforces required string fields and passes when filled", () => {
    const s = buildFormZodSchema(
      schema({
        base_fields: {
          first_name: field({ type: "text", label: "First name", required: true }),
        },
      }),
    )
    expect(s.safeParse({ first_name: "" }).success).toBe(false)
    expect(s.safeParse({ first_name: "Ada" }).success).toBe(true)
  })

  it("treats all fields optional in draft mode", () => {
    const s = buildFormZodSchema(
      schema({
        base_fields: {
          first_name: field({ type: "text", label: "First name", required: true }),
        },
      }),
      true,
    )
    expect(s.safeParse({}).success).toBe(true)
  })

  it("validates the email field as an address", () => {
    const s = buildFormZodSchema(
      schema({ base_fields: { email: field({ type: "text", label: "Email", required: true }) } }),
    )
    expect(s.safeParse({ email: "nope" }).success).toBe(false)
    expect(s.safeParse({ email: "a@b.co" }).success).toBe(true)
  })

  it("enforces multiselect_detailed min/max selections", () => {
    const s = buildFormZodSchema(
      schema({
        base_fields: {
          diet: field({
            type: "multiselect_detailed",
            label: "Diet",
            required: true,
            config: { min_selections: 2, max_selections: 3 },
          }),
        },
      }),
    )
    expect(s.safeParse({ diet: ["a"] }).success).toBe(false)
    expect(s.safeParse({ diet: ["a", "b"] }).success).toBe(true)
    expect(s.safeParse({ diet: ["a", "b", "c", "d"] }).success).toBe(false)
  })

  it("prefixes custom fields with custom_", () => {
    const s = buildFormZodSchema(
      schema({
        custom_fields: {
          shirt: field({ type: "text", label: "Shirt", required: true }),
        },
      }),
    )
    expect(s.safeParse({ custom_shirt: "" }).success).toBe(false)
    expect(s.safeParse({ custom_shirt: "L" }).success).toBe(true)
  })
})

describe("validation helpers", () => {
  const s = buildFormZodSchema(
    schema({
      base_fields: {
        first_name: field({ type: "text", label: "First name", required: true }),
        email: field({ type: "text", label: "Email", required: true }),
      },
    }),
  )

  it("validateBuyerValues reports per-field errors", () => {
    const res = validateBuyerValues(s, { first_name: "", email: "bad" })
    expect(res.valid).toBe(false)
    expect(res.errors.first_name).toContain("required")
    expect(res.errors.email).toContain("valid email")
  })

  it("isBuyerComplete / invalidFields agree", () => {
    expect(isBuyerComplete(s, { first_name: "Ada", email: "a@b.co" })).toBe(true)
    expect(invalidFields(s, { first_name: "", email: "a@b.co" })).toEqual(["first_name"])
  })
})

describe("stripCustomPrefix / toBuyerInfo", () => {
  it("keeps only custom_ entries and strips the prefix", () => {
    expect(
      stripCustomPrefix({ first_name: "Ada", custom_shirt: "L", custom_diet: ["v"] }),
    ).toEqual({ shirt: "L", diet: ["v"] })
  })

  it("builds BuyerInfo with stripped form_data", () => {
    expect(
      toBuyerInfo({
        email: "a@b.co",
        firstName: "Ada",
        lastName: "Lovelace",
        formData: { first_name: "Ada", custom_shirt: "L" },
      }),
    ).toEqual({
      email: "a@b.co",
      first_name: "Ada",
      last_name: "Lovelace",
      form_data: { shirt: "L" },
    })
  })
})
