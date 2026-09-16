// Local mirror of the buyer/application form schema, re-declared here (not
// imported from @edgeos/shared-form-ui) so the core stays self-contained and
// publishable without pulling in that package's React component graph. Keep the
// subset the Zod builder needs in sync with
// `packages/shared-form-ui/src/types.ts`.

export type FormFieldType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "select_cards"
  | "multiselect"
  | "multiselect_detailed"
  | "radio"
  | "date"
  | "email"
  | "url"
  | "phone"
  | "rich_text"
  | "image_upload"
  | "country_select"
  | "signature"

export interface FormFieldSchema {
  type: FormFieldType
  label: string
  required: boolean
  section?: string
  section_id?: string | null
  position?: number
  options?: string[]
  placeholder?: string
  help_text?: string
  target?: "human" | "application"
  min_date?: string | null
  max_date?: string | null
  config?: Record<string, unknown>
  width?: "full" | "half" | "half_row" | null
}

/** The runtime `form_schema` payload shape (from GET /checkout/{slug}/{flowSlug}/runtime). */
export interface ApplicationFormSchema {
  base_fields: Record<string, FormFieldSchema>
  custom_fields: Record<string, FormFieldSchema>
  sections?: Array<{
    id: string
    label: string
    description: string | null
    order: number
    kind: string
  }>
}

export interface MultiSelectDetailedConfig {
  subtitles?: Record<string, string>
  min_selections?: number | null
  max_selections?: number | null
}
