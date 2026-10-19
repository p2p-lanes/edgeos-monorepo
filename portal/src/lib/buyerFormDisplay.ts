import type { ApplicationFormSchema } from "@/types/form-schema"

export type KnownBuyer = {
  email?: string
  firstName?: string
  lastName?: string
}

/** Only session-provided identity is hidden; typed answers stay editable. */
export function buyerFormDisplaySchema(
  schema: ApplicationFormSchema,
  buyer?: KnownBuyer,
): ApplicationFormSchema {
  const baseFields = { ...schema.base_fields }
  const known = {
    email: buyer?.email,
    first_name: buyer?.firstName,
    last_name: buyer?.lastName,
  }
  for (const [field, value] of Object.entries(known)) {
    if (value?.trim()) delete baseFields[field]
  }
  return { ...schema, base_fields: baseFields }
}
