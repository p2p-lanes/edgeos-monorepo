import { FormInputWrapper } from "../FormInputWrapper"
import type { ErrorTone } from "../Input"
import { LabelMuted, LabelRequired } from "../Label"
import { Textarea } from "../Textarea"

const ERROR_BORDER_CLASS: Record<ErrorTone, string> = {
  destructive: "border-red-500",
  warning: "border-amber-500",
}
const ERROR_TEXT_CLASS: Record<ErrorTone, string> = {
  destructive: "text-red-500",
  warning: "text-amber-600",
}

export interface TextAreaFormProps {
  label: string
  id: string
  value: string
  handleChange: (value: string) => void
  error: string
  /** Visual tone for the error state. Default `destructive` (red); opt
   *  in to `warning` (amber). */
  errorTone?: ErrorTone
  isRequired?: boolean
  subtitle?: string
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
}

export const TextAreaForm = ({
  label,
  id,
  value,
  error,
  errorTone = "destructive",
  handleChange,
  isRequired,
  subtitle,
  placeholder,
  disabled,
  readOnly,
}: TextAreaFormProps) => {
  return (
    <FormInputWrapper>
      {(label || subtitle) && (
        <div className="flex flex-col gap-2">
          {label && (
            <LabelRequired htmlFor={id} isRequired={isRequired}>
              {label}
            </LabelRequired>
          )}
          {subtitle && (
            <LabelMuted className="text-sm text-muted-foreground">
              {subtitle}
            </LabelMuted>
          )}
        </div>
      )}
      <Textarea
        id={id}
        className={`min-h-[72px] mt-2 ${error ? ERROR_BORDER_CLASS[errorTone] : ""}`}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
      />
      {error && (
        <p className={`${ERROR_TEXT_CLASS[errorTone]} text-sm`}>{error}</p>
      )}
    </FormInputWrapper>
  )
}
