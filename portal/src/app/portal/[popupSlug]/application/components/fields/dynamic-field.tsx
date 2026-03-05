import { SchemaField } from "@edgeos/shared-form-ui"
import type { FormFieldSchema } from "@/types/form-schema"

interface DynamicFieldProps {
  name: string
  field: FormFieldSchema
  value: unknown
  error?: string
  onChange: (name: string, value: unknown) => void
  hideLabelAndSubtitle?: boolean
}

export function DynamicField({
  name,
  field,
  value,
  error,
  onChange,
  hideLabelAndSubtitle = false,
}: DynamicFieldProps) {
  return (
    <SchemaField
      name={name}
      field={field}
      value={value}
      error={error}
      onChange={onChange}
      hideLabelAndSubtitle={hideLabelAndSubtitle}
    />
  )
}
