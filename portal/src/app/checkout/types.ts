import type {
  ApplicationFormSchema,
  FormFieldSchema,
} from "@/types/form-schema"

export type CheckoutApplicationValues = Record<string, unknown>

export interface CheckoutSchemaSectionField {
  name: string
  field: FormFieldSchema
  isCustom: boolean
}

export interface CheckoutSchemaSection {
  id: string
  title: string
  subtitle?: string
  fields: CheckoutSchemaSectionField[]
}

export const SUPPORTED_CHECKOUT_FIELD_TYPE = {
  TEXT: "text",
  TEXTAREA: "textarea",
  NUMBER: "number",
  BOOLEAN: "boolean",
  SELECT: "select",
  SELECT_CARDS: "select_cards",
  MULTISELECT: "multiselect",
  DATE: "date",
  EMAIL: "email",
  URL: "url",
} as const

export const HUMAN_FIELD_KEYS = new Set([
  "email",
  "first_name",
  "last_name",
  "telegram",
  "gender",
  "age",
  "residence",
])

export const CHECKOUT_BASE_FIELD_KEYS = new Set([
  "email",
  "first_name",
  "last_name",
  "telegram",
  "gender",
  "age",
  "residence",
])

export interface DefaultCheckoutFormData {
  first_name: string
  last_name: string
  email: string
  telegram: string
  gender: string
  email_verified: boolean
  local_resident: string
}

export interface GenderOption {
  value: string
  label: string
}

function getStringCheckoutValue(
  values: CheckoutApplicationValues | DefaultCheckoutFormData,
  key: keyof DefaultCheckoutFormData,
): string {
  const value = values[key]
  return typeof value === "string" ? value : ""
}

function getBooleanCheckoutValue(
  values: CheckoutApplicationValues | DefaultCheckoutFormData,
  key: keyof DefaultCheckoutFormData,
): boolean {
  const value = values[key]
  return typeof value === "boolean" ? value : false
}

export function toDefaultCheckoutFormData(
  values: CheckoutApplicationValues | DefaultCheckoutFormData,
): DefaultCheckoutFormData {
  return {
    first_name: getStringCheckoutValue(values, "first_name"),
    last_name: getStringCheckoutValue(values, "last_name"),
    email: getStringCheckoutValue(values, "email"),
    telegram: getStringCheckoutValue(values, "telegram"),
    gender: getStringCheckoutValue(values, "gender"),
    email_verified: getBooleanCheckoutValue(values, "email_verified"),
    local_resident: getStringCheckoutValue(values, "local_resident"),
  }
}

export function getCheckoutFieldDefaultValue(field: FormFieldSchema): unknown {
  if (field.type === SUPPORTED_CHECKOUT_FIELD_TYPE.BOOLEAN) return false
  if (field.type === SUPPORTED_CHECKOUT_FIELD_TYPE.MULTISELECT) return []
  return ""
}

export function isCheckoutBaseField(name: string, field: FormFieldSchema) {
  return CHECKOUT_BASE_FIELD_KEYS.has(name) || field.target === "human"
}

function getCheckoutVisibleSectionIds(
  baseFields: Record<string, FormFieldSchema>,
): Set<string> {
  const sectionIds = new Set<string>()

  for (const [name, field] of Object.entries(baseFields)) {
    if (!isCheckoutBaseField(name, field)) continue
    sectionIds.add(field.section_id || "_unsectioned_base")
  }

  return sectionIds
}

export function getCheckoutMiniFormSchema(
  schema: ApplicationFormSchema,
): ApplicationFormSchema {
  const visibleSectionIds = getCheckoutVisibleSectionIds(schema.base_fields)

  return {
    ...schema,
    base_fields: Object.fromEntries(
      Object.entries(schema.base_fields).filter(([name, field]) =>
        isCheckoutBaseField(name, field),
      ),
    ),
    custom_fields: Object.fromEntries(
      Object.entries(schema.custom_fields).filter(([, field]) =>
        visibleSectionIds.has(field.section_id || "_unsectioned_base"),
      ),
    ),
  }
}

export function filterCheckoutApplicationValues(
  schema: ApplicationFormSchema,
  values: CheckoutApplicationValues,
): CheckoutApplicationValues {
  const miniFormSchema = getCheckoutMiniFormSchema(schema)
  const allowedKeys = new Set([
    ...Object.keys(miniFormSchema.base_fields),
    ...Object.keys(miniFormSchema.custom_fields).map(
      (name) => `custom_${name}`,
    ),
    "gender_specify",
    "email_verified",
  ])

  return Object.fromEntries(
    Object.entries(values).filter(([key]) => allowedKeys.has(key)),
  )
}

export function getCheckoutSchemaSections(
  schema: ApplicationFormSchema,
): CheckoutSchemaSection[] {
  const miniFormSchema = getCheckoutMiniFormSchema(schema)
  const groupedFields: Record<string, CheckoutSchemaSectionField[]> = {}

  for (const [name, field] of Object.entries(miniFormSchema.base_fields)) {
    const sectionId = field.section_id || "_unsectioned_base"
    if (!groupedFields[sectionId]) groupedFields[sectionId] = []
    groupedFields[sectionId].push({ name, field, isCustom: false })
  }

  for (const [name, field] of Object.entries(miniFormSchema.custom_fields)) {
    const sectionId = field.section_id || "_unsectioned_base"
    if (!groupedFields[sectionId]) groupedFields[sectionId] = []
    groupedFields[sectionId].push({
      name: `custom_${name}`,
      field,
      isCustom: true,
    })
  }

  for (const fields of Object.values(groupedFields)) {
    fields.sort(
      (left, right) => (left.field.position ?? 0) - (right.field.position ?? 0),
    )
  }

  const sections: CheckoutSchemaSection[] = []
  const orderedSchemaSections = [...(schema.sections ?? [])].sort(
    (left, right) => (left.order ?? 0) - (right.order ?? 0),
  )

  if (groupedFields._unsectioned_base?.length) {
    sections.push({
      id: "_unsectioned_base",
      title: "Personal information",
      subtitle: undefined,
      fields: groupedFields._unsectioned_base,
    })
    delete groupedFields._unsectioned_base
  }

  for (const section of orderedSchemaSections) {
    const fields = groupedFields[section.id] ?? []
    if (fields.length === 0) continue
    sections.push({
      id: section.id,
      title: section.label,
      subtitle: section.description ?? undefined,
      fields,
    })
    delete groupedFields[section.id]
  }

  for (const [id, fields] of Object.entries(groupedFields)) {
    if (fields.length === 0) continue
    sections.push({
      id,
      title: "Other",
      subtitle: undefined,
      fields,
    })
  }

  return sections
}

export type CheckoutState = "form" | "processing" | "success" | "passes"
