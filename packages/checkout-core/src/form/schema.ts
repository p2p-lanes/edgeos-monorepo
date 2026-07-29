// Ported 1:1 from portal `src/lib/form-schema-builder.ts`. Builds a Zod schema
// from the API `form_schema` so a custom checkout validates buyer input exactly
// like the portal. Uses `zod/v4` (matching the portal import) for identical
// behavior. The portal's `fieldsOptionalWhenChildrenSection` param is an
// application-companions feature not present in open checkout, so it is dropped.

import { z } from "zod/v4"
import type {
  ApplicationFormSchema,
  FormFieldSchema,
  MultiSelectDetailedConfig,
} from "../types/form"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function fieldToZod(field: FormFieldSchema, fieldName: string): z.ZodType {
  switch (field.type) {
    case "boolean":
      return z.boolean()
    case "multiselect":
    case "multiselect_detailed":
      return z.array(z.string())
    case "number":
      return z.string()
    case "email":
      return z.string().refine((v) => v === "" || EMAIL_RE.test(v), {
        error: "Enter a valid email address",
      })
    case "rich_text":
      return field.config?.is_checkbox ? z.boolean() : z.unknown()
    case "signature":
      return z.object({
        signature: z.string().optional(),
        signed_at: z.string().optional(),
      })
    default:
      // The buyer step's `email` slot is a plain string in the runtime schema,
      // but the field name is literally "email" — validate it as an address.
      if (fieldName === "email") {
        return z.string().refine((v) => v === "" || EMAIL_RE.test(v), {
          error: "Enter a valid email address",
        })
      }
      return z.string()
  }
}

function makeOptional(zodType: z.ZodType): z.ZodType {
  return zodType.optional()
}

function makeRequired(zodType: z.ZodType, field: FormFieldSchema): z.ZodType {
  if (field.type === "signature") {
    const requireDate = !!field.config?.require_date
    return z.object({
      signature: z.string().min(1, `${field.label} is required`),
      signed_at: requireDate
        ? z.string().min(1, "Date is required")
        : z.string().optional(),
    })
  }
  if (field.type === "rich_text" && field.config?.is_checkbox) {
    return z
      .boolean()
      .refine((v) => v === true, { message: "This field is required" })
  }
  if (zodType instanceof z.ZodString) {
    return zodType.min(1, `${field.label} is required`)
  }
  if (zodType instanceof z.ZodArray) {
    if (field.type === "multiselect_detailed") {
      const config = field.config as MultiSelectDetailedConfig | undefined
      const minSel = config?.min_selections
      const maxSel = config?.max_selections
      let arr = zodType.min(
        typeof minSel === "number" && minSel > 0 ? minSel : 1,
        typeof minSel === "number" && minSel > 1
          ? `${field.label} requires at least ${minSel} selections`
          : `${field.label} is required`,
      )
      if (typeof maxSel === "number" && maxSel > 0) {
        arr = arr.max(
          maxSel,
          `${field.label} allows at most ${maxSel} selections`,
        )
      }
      return arr
    }
    return zodType.min(1, `${field.label} is required`)
  }
  return zodType
}

/**
 * Build a Zod object schema from the API form schema. When `isDraft` is true,
 * every field is optional (partial saves); otherwise `required` fields are
 * enforced. Custom fields are keyed with the `custom_` prefix, matching the
 * portal's form state.
 */
export function buildFormZodSchema(
  schema: ApplicationFormSchema,
  isDraft = false,
): z.ZodObject {
  const shape: Record<string, z.ZodType> = {}

  for (const [name, field] of Object.entries(schema.base_fields)) {
    const zodType = fieldToZod(field, name)
    shape[name] =
      isDraft || !field.required
        ? makeOptional(zodType)
        : makeRequired(zodType, field)
  }

  // gender_specify is a virtual field for the "Specify" sub-field.
  shape.gender_specify = z.string().optional()

  for (const [name, field] of Object.entries(schema.custom_fields)) {
    const zodType = fieldToZod(field, `custom_${name}`)
    shape[`custom_${name}`] =
      isDraft || !field.required
        ? makeOptional(zodType)
        : makeRequired(zodType, field)
  }

  return z.object(shape).passthrough()
}
