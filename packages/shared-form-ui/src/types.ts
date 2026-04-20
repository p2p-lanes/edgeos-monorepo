export interface FormFieldSchema {
  type:
    | "text"
    | "textarea"
    | "number"
    | "boolean"
    | "select"
    | "select_cards"
    | "multiselect"
    | "date"
    | "email"
    | "url"
  label: string
  required: boolean
  section?: string
  section_id?: string | null
  position?: number
  options?: string[]
  placeholder?: string
  help_text?: string
  target?: "human" | "application"
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
