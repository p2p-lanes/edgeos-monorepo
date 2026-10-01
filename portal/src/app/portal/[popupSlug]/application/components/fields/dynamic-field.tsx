import { type ErrorTone, SchemaField } from "@edgeos/shared-form-ui"
import { useTranslation } from "react-i18next"
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
  portalContentClassName?: string
}

export function DynamicField({
  name,
  field,
  value,
  error,
  onChange,
  hideLabelAndSubtitle = false,
  errorTone,
  portalContentClassName,
}: DynamicFieldProps) {
  const { t } = useTranslation()

  return (
    <SchemaField
      name={name}
      field={field}
      value={value}
      error={error}
      onChange={onChange}
      hideLabelAndSubtitle={hideLabelAndSubtitle}
      errorTone={errorTone}
      portalContentClassName={portalContentClassName}
      multiSelectDetailedLabels={{
        placeholder: t("form.multiselect.placeholder"),
        search: t("form.multiselect.search"),
        searchLabel: t("form.multiselect.search_label"),
        empty: t("form.multiselect.empty"),
        selected: (count) => t("form.multiselect.selected", { count }),
        remove: (option) => t("form.multiselect.remove", { option }),
        between: (min, max) => t("form.multiselect.between", { min, max }),
        atLeast: (min) => t("form.multiselect.at_least", { min }),
        upTo: (max) => t("form.multiselect.up_to", { max }),
      }}
    />
  )
}
