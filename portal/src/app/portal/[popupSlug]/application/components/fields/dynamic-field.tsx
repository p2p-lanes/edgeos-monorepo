import { type ErrorTone, SchemaField } from "@edgeos/shared-form-ui"
import type { FormFieldSchema } from "@/types/form-schema"

interface DynamicFieldProps {
  name: string
  field: FormFieldSchema
  value: unknown
  error?: string
  onChange: (name: string, value: unknown) => void
  hideLabelAndSubtitle?: boolean
  /** Visual tone for the inline error state. Default `destructive`
   *  (red); the open-ticketing buyer step opts into `warning` (amber)
   *  to match the CheckoutToast banner palette. */
  errorTone?: ErrorTone
}

export function DynamicField({
  name,
  field,
  value,
  error,
  onChange,
  hideLabelAndSubtitle = false,
  errorTone,
}: DynamicFieldProps) {
  return (
    <SchemaField
      name={name}
      field={field}
      value={value}
      error={error}
      onChange={onChange}
      hideLabelAndSubtitle={hideLabelAndSubtitle}
      errorTone={errorTone}
    />
  )
}
