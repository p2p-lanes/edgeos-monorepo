import type { ApplicationFormSchema } from "@/types/form-schema"

/** A disabled or omitted buyer step collects no answers; payment still needs identity. */
export function buyerFormValidationSchema(
  schema: ApplicationFormSchema | null,
  enabled: boolean,
): ApplicationFormSchema | null {
  if (!schema || enabled) return schema
  return {
    base_fields: Object.fromEntries(
      Object.entries(schema.base_fields).filter(([name]) =>
        ["email", "first_name", "last_name"].includes(name),
      ),
    ),
    custom_fields: {},
    sections: [],
  }
}
