import { AddonInput } from "../AddonInput"
import { FormInputWrapper } from "../FormInputWrapper"
import type { ErrorTone } from "../Input"
import { LabelMuted, LabelRequired } from "../Label"

const ERROR_BORDER_CLASS: Record<ErrorTone, string> = {
  destructive: "border-red-500",
  warning: "border-amber-500",
}
const ERROR_TEXT_CLASS: Record<ErrorTone, string> = {
  destructive: "text-red-500",
  warning: "text-amber-600",
}

export interface AddonInputFormProps {
  label: string
  id: string
  value?: string
  onChange: (value: string) => void
  error?: string
  /** Visual tone for the error state. Default `destructive` (red); opt
   *  in to `warning` (amber). */
  errorTone?: ErrorTone
  isRequired?: boolean
  subtitle?: string
  addon?: string
  placeholder?: string
}

export const AddonInputForm = ({
  label,
  id,
  value,
  onChange,
  error,
  errorTone = "destructive",
  isRequired = false,
  subtitle,
  addon,
  placeholder,
}: AddonInputFormProps) => {
  return (
    <FormInputWrapper>
      <div className="flex flex-col gap-2">
        <LabelRequired htmlFor={id} isRequired={isRequired}>
          {label}
        </LabelRequired>
        {subtitle && (
          <LabelMuted className="text-sm text-muted-foreground">
            {subtitle}
          </LabelMuted>
        )}
      </div>
      <AddonInput
        id={id}
        addon={addon}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={error ? ERROR_BORDER_CLASS[errorTone] : ""}
      />
      {error && (
        <p className={`${ERROR_TEXT_CLASS[errorTone]} text-sm`}>{error}</p>
      )}
    </FormInputWrapper>
  )
}
