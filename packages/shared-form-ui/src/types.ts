export interface FormFieldSchema {
  type:
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
  /** Layout override. When undefined/null, falls back to a type-based heuristic. */
  width?: "full" | "half" | null
}

export type FormSectionKind = "standard" | "companions" | "scholarship"

export interface FormSectionSchema {
  id: string
  label: string
  description: string | null
  order: number
  kind: FormSectionKind
}

export interface ApplicationFormSchema {
  base_fields: Record<string, FormFieldSchema>
  custom_fields: Record<string, FormFieldSchema>
  sections: FormSectionSchema[]
}

export interface RichTextConfig {
  /** Markdown source. Rendered with react-markdown + remark-gfm. */
  content: string
  is_checkbox: boolean
}

export interface ImageUploadConfig {
  button_text?: string
}

export interface SignatureConfig {
  pdf_url: string
  require_date: boolean
}

export interface SignatureValue {
  signature?: string
  signed_at?: string
}

export interface MultiSelectDetailedConfig {
  subtitles?: Record<string, string>
  min_selections?: number | null
  max_selections?: number | null
}
