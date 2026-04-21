import { useCallback, useMemo, useReducer } from "react"
import { useTranslation } from "react-i18next"
import type { ApplicationPublic } from "@/client"
import { buildFormZodSchema } from "@/lib/form-schema-builder"
import type {
  ApplicationFormSchema,
  FormFieldSchema,
  FormSectionKind,
} from "@/types/form-schema"

const HUMAN_FIELD_KEYS = new Set([
  "first_name",
  "last_name",
  "telegram",
  "gender",
  "age",
  "residence",
])

interface FormState {
  values: Record<string, unknown>
  errors: Record<string, string>
  touched: Set<string>
}

type FormAction =
  | { type: "SET_FIELD"; name: string; value: unknown }
  | { type: "SET_ERRORS"; errors: Record<string, string> }
  | { type: "SET_VALUES"; values: Record<string, unknown> }
  | { type: "RESET" }

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "SET_FIELD":
      if (Object.is(state.values[action.name], action.value)) return state
      return {
        ...state,
        values: { ...state.values, [action.name]: action.value },
        touched: new Set(state.touched).add(action.name),
        // Clear error for this field on change
        errors: { ...state.errors, [action.name]: "" },
      }
    case "SET_ERRORS":
      return { ...state, errors: action.errors }
    case "SET_VALUES":
      return { ...state, values: { ...state.values, ...action.values } }
    case "RESET":
      return { values: {}, errors: {}, touched: new Set() }
    default:
      return state
  }
}

function getDefaultValue(field: FormFieldSchema): unknown {
  if (field.type === "boolean") return false
  if (field.type === "multiselect") return []
  return ""
}

function getInitialValues(
  schema: ApplicationFormSchema,
  app?: ApplicationPublic | null,
  popupId?: string,
): Record<string, unknown> {
  const values: Record<string, unknown> = {}

  // Initialize ALL base fields from schema with defaults
  for (const [name, field] of Object.entries(schema.base_fields)) {
    values[name] = getDefaultValue(field)
  }

  // Virtual field for gender "Specify" sub-field
  values.gender_specify = ""

  // Custom fields
  for (const [name, field] of Object.entries(schema.custom_fields)) {
    values[`custom_${name}`] = getDefaultValue(field)
  }

  if (!app) return values

  const isExistingApplication = app.popup_id === popupId

  if (isExistingApplication) {
    // Full populate: human fields, application-scoped fields, custom fields
    for (const [name, field] of Object.entries(schema.base_fields)) {
      if (
        (field.target === "human" || HUMAN_FIELD_KEYS.has(name)) &&
        app.human
      ) {
        const v = (app.human as Record<string, unknown>)[name]
        values[name] = v ?? getDefaultValue(field)
      } else {
        const v = (app as Record<string, unknown>)[name]
        values[name] = v ?? getDefaultValue(field)
      }
    }
    for (const [name, field] of Object.entries(schema.custom_fields)) {
      values[`custom_${name}`] =
        app.custom_fields?.[name] ?? getDefaultValue(field)
    }
  } else {
    // Import: only human profile fields from another popup's application
    for (const [name, field] of Object.entries(schema.base_fields)) {
      if (field.target === "human" && app.human) {
        const v = (app.human as Record<string, unknown>)[name]
        values[name] = v ?? getDefaultValue(field)
      }
    }
  }

  // Resolve gender "Specify" virtual field
  const genderOptions = schema.base_fields.gender?.options ?? []
  const g = values.gender as string
  if (g && !genderOptions.includes(g)) {
    values.gender_specify = g
    values.gender = "Specify"
  }

  return values
}

/** Collect the base field names that live in any section of the given kind. */
function getFieldsInSectionKind(
  schema: ApplicationFormSchema,
  kind: FormSectionKind,
): Set<string> {
  const sectionIds = (schema.sections ?? [])
    .filter((s) => s.kind === kind)
    .map((s) => s.id)
  return new Set(
    Object.entries(schema.base_fields)
      .filter(([, f]) => f.section_id && sectionIds.includes(f.section_id))
      .map(([name]) => name),
  )
}

export function useApplicationForm(
  schema: ApplicationFormSchema,
  initialApplication?: ApplicationPublic | null,
  popupId?: string,
) {
  const { t } = useTranslation()

  // Base fields that render via custom UI sections (CompanionsSection,
  // ScholarshipSection) — Zod skips them because those sections handle
  // their own validation and data shape.
  const fieldsReplacedByCustomSection = useMemo(
    () =>
      new Set([
        ...getFieldsInSectionKind(schema, "companions"),
        ...getFieldsInSectionKind(schema, "scholarship"),
      ]),
    [schema],
  )

  const hasScholarshipSection = useMemo(
    () => (schema.sections ?? []).some((s) => s.kind === "scholarship"),
    [schema],
  )

  const [state, dispatch] = useReducer(formReducer, undefined, () => ({
    values: getInitialValues(schema, initialApplication, popupId),
    errors: {} as Record<string, string>,
    touched: new Set<string>(),
  }))

  const handleChange = useCallback((name: string, value: unknown) => {
    dispatch({ type: "SET_FIELD", name, value })
  }, [])

  const validate = useCallback(
    (
      isDraft: boolean,
    ): { isValid: boolean; errors: Record<string, string> } => {
      const zodSchema = buildFormZodSchema(
        schema,
        isDraft,
        fieldsReplacedByCustomSection,
      )
      const result = zodSchema.safeParse(state.values)

      const errors: Record<string, string> = {}
      if (!result.success) {
        for (const issue of result.error.issues) {
          const path = issue.path.join(".")
          if (!errors[path]) {
            errors[path] = issue.message
          }
        }
      }

      // Scholarship details are required when the applicant is requesting a
      // scholarship. Enforced here (not in Zod) because the dependency is
      // on another field's runtime value, and ScholarshipSection owns the
      // scholarship_request/details/video_url subset of the schema.
      if (
        !isDraft &&
        hasScholarshipSection &&
        state.values.scholarship_request
      ) {
        const details = (state.values.scholarship_details as string) ?? ""
        if (!details.trim()) {
          errors.scholarship_details = t(
            "application.scholarship.details_required_error",
          )
        }
      }

      const isValid = Object.keys(errors).length === 0
      dispatch({ type: "SET_ERRORS", errors })
      return { isValid, errors }
    },
    [
      schema,
      state.values,
      fieldsReplacedByCustomSection,
      hasScholarshipSection,
      t,
    ],
  )

  const progress = useMemo(() => {
    const allFields = { ...schema.base_fields, ...schema.custom_fields }
    const requiredFields = Object.entries(allFields).filter(
      ([name, f]) => f.required && !fieldsReplacedByCustomSection.has(name),
    )
    if (requiredFields.length === 0) return 100

    const total = requiredFields.length
    let filled = 0

    for (const [name, field] of requiredFields) {
      // Check both base and custom field naming
      const key = schema.custom_fields[name] ? `custom_${name}` : name
      const val = state.values[key]

      if (field.type === "boolean") {
        if (val === true) filled++
      } else if (field.type === "multiselect") {
        if (Array.isArray(val) && val.length > 0) filled++
      } else if (val && String(val).trim()) {
        filled++
      }
    }

    return Math.round((filled / total) * 100)
  }, [schema, state.values, fieldsReplacedByCustomSection])

  return {
    values: state.values,
    errors: state.errors,
    handleChange,
    validate,
    setValues: (values: Record<string, unknown>) =>
      dispatch({ type: "SET_VALUES", values }),
    setErrors: (errors: Record<string, string>) =>
      dispatch({ type: "SET_ERRORS", errors }),
    progress,
    hasScholarshipSection,
  }
}
