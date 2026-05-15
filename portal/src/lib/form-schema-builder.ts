import { z } from "zod/v4"
import type {
  ApplicationFormSchema,
  FormFieldSchema,
  MultiSelectDetailedConfig,
} from "@/types/form-schema"

function fieldToZod(field: FormFieldSchema): z.ZodType {
  switch (field.type) {
    case "boolean":
      return z.boolean()
    case "multiselect":
    case "multiselect_detailed":
      return z.array(z.string())
    case "number":
      return z.string()
    case "rich_text":
      // Checkbox-mode rich_text stores a bool; display-only stores nothing
      // meaningful but we keep the field in state to roundtrip cleanly.
      return field.config?.is_checkbox ? z.boolean() : z.unknown()
    case "signature":
      return z.object({
        signature: z.string().optional(),
        signed_at: z.string().optional(),
      })
    default:
      return z.string()
  }
}

export function buildFormZodSchema(
  schema: ApplicationFormSchema,
  isDraft: boolean,
  fieldsOptionalWhenChildrenSection?: Set<string>,
): z.ZodObject {
  const shape: Record<string, z.ZodType> = {}

  // Base fields from schema (all profile + application fields)
  for (const [name, field] of Object.entries(schema.base_fields)) {
    const zodType = fieldToZod(field)
    const isReplacedByChildrenSection =
      fieldsOptionalWhenChildrenSection?.has(name)
    shape[name] =
      isDraft || !field.required || isReplacedByChildrenSection
        ? makeOptional(zodType)
        : makeRequired(zodType, field)
  }

  // gender_specify is a virtual field for the "Specify" sub-field
  shape.gender_specify = z.string().optional()

  // Custom fields from schema
  for (const [name, field] of Object.entries(schema.custom_fields)) {
    const zodType = fieldToZod(field)
    shape[`custom_${name}`] =
      isDraft || !field.required
        ? makeOptional(zodType)
        : makeRequired(zodType, field)
  }

  return z.object(shape).passthrough()
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
  // boolean required means must be true
  return zodType
}
