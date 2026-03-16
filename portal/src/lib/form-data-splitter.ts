import type {
  ApplicationCreate,
  ApplicationUpdate,
  CompanionCreate,
  UserSettableStatus,
} from "@/client"
import type { ApplicationFormSchema } from "@/types/form-schema"

/** Build a target map from the schema: field name → "human" | "application" */
function buildTargetMap(
  schema: ApplicationFormSchema,
): Record<string, "human" | "application"> {
  const map: Record<string, "human" | "application"> = {}
  for (const [name, field] of Object.entries(schema.base_fields)) {
    map[name] = field.target ?? "application"
  }
  return map
}

interface SplitCreateParams {
  values: Record<string, unknown>
  popupId: string
  companions: CompanionCreate[]
  status: UserSettableStatus
  schema: ApplicationFormSchema
}

export function splitForCreate({
  values,
  popupId,
  companions,
  status,
  schema,
}: SplitCreateParams): ApplicationCreate {
  const targetMap = buildTargetMap(schema)
  const profile: Record<string, unknown> = {}
  const application: Record<string, unknown> = {}
  const customFields: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(values)) {
    if (value === "" || value === null || value === undefined) continue
    // Skip virtual fields (e.g. gender_specify)
    if (key === "gender_specify") continue

    if (key.startsWith("custom_")) {
      const fieldName = key.slice(7) // remove "custom_" prefix
      if (Array.isArray(value) && value.length === 0) continue
      customFields[fieldName] = value
    } else if (targetMap[key] === "human") {
      profile[key] = value
    } else if (targetMap[key] === "application") {
      application[key] = value
    }
    // Fields NOT in targetMap (not in current schema) are silently dropped
  }

  // Fallback: known human fields are always sent from values when present
  // (schema may omit target or use "application" for age/gender)
  const humanFieldKeys = [
    "first_name",
    "last_name",
    "telegram",
    "gender",
    "age",
    "residence",
  ] as const
  for (const k of humanFieldKeys) {
    if (
      profile[k] === undefined &&
      values[k] !== undefined &&
      values[k] !== "" &&
      values[k] !== null
    ) {
      profile[k] = values[k]
    }
  }

  return {
    popup_id: popupId,
    first_name: (profile.first_name as string) ?? "",
    last_name: (profile.last_name as string) ?? "",
    telegram: (profile.telegram ?? values.telegram) as string | undefined,
    gender: (profile.gender ?? values.gender) as string | undefined,
    age: (profile.age ?? values.age) as string | undefined,
    residence: (profile.residence ?? values.residence) as string | undefined,
    referral: application.referral as string | undefined,
    info_not_shared: application.info_not_shared as string[] | undefined,
    custom_fields:
      Object.keys(customFields).length > 0 ? customFields : undefined,
    status,
    companions: companions.length > 0 ? companions : undefined,
    // Application-target base fields from the schema (scholarship, etc.)
    // Only fields present in the current popup's schema are included —
    // fields from a previous popup that don't exist here are already
    // filtered out by the targetMap loop above.
    ...application,
  }
}

interface SplitUpdateParams {
  values: Record<string, unknown>
  status: UserSettableStatus
  schema: ApplicationFormSchema
}

export function splitForUpdate({
  values,
  status,
  schema,
}: SplitUpdateParams): ApplicationUpdate {
  const targetMap = buildTargetMap(schema)
  const profile: Record<string, unknown> = {}
  const application: Record<string, unknown> = {}
  const customFields: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(values)) {
    if (value === "" || value === null || value === undefined) continue
    if (key === "gender_specify") continue

    if (key.startsWith("custom_")) {
      const fieldName = key.slice(7)
      if (Array.isArray(value) && value.length === 0) continue
      customFields[fieldName] = value
    } else if (targetMap[key] === "human") {
      profile[key] = value
    } else if (targetMap[key] === "application") {
      application[key] = value
    }
    // Fields NOT in targetMap (not in current schema) are silently dropped
  }

  // Fallback: known human fields from values when not in profile
  const humanFieldKeys = [
    "first_name",
    "last_name",
    "telegram",
    "gender",
    "age",
    "residence",
  ] as const
  for (const k of humanFieldKeys) {
    if (
      profile[k] === undefined &&
      values[k] !== undefined &&
      values[k] !== "" &&
      values[k] !== null
    ) {
      profile[k] = values[k]
    }
  }

  return {
    first_name: (profile.first_name ?? values.first_name) as string | undefined,
    last_name: (profile.last_name ?? values.last_name) as string | undefined,
    telegram: (profile.telegram ?? values.telegram) as string | undefined,
    gender: (profile.gender ?? values.gender) as string | undefined,
    age: (profile.age ?? values.age) as string | undefined,
    residence: (profile.residence ?? values.residence) as string | undefined,
    referral: application.referral as string | undefined,
    info_not_shared: application.info_not_shared as string[] | undefined,
    custom_fields:
      Object.keys(customFields).length > 0 ? customFields : undefined,
    status,
    // Application-target base fields from the schema (scholarship, etc.)
    // Only fields present in the current popup's schema are included.
    ...application,
  }
}
