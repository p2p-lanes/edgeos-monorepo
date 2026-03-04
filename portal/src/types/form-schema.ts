export interface FormFieldSchema {
  type:
    | "text"
    | "textarea"
    | "number"
    | "boolean"
    | "select"
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

export interface FormSectionSchema {
  id: string
  label: string
  description: string | null
  order: number
}

export interface ApplicationFormSchema {
  base_fields: Record<string, FormFieldSchema>
  custom_fields: Record<string, FormFieldSchema>
  sections: FormSectionSchema[]
}
