import { FormInputWrapper } from "../FormInputWrapper"
import { type ErrorTone, Input } from "../Input"
import { LabelMuted, LabelRequired } from "../Label"

const ERROR_TEXT_CLASS: Record<ErrorTone, string> = {
  destructive: "text-red-500",
  warning: "text-amber-600",
}

export interface InputFormProps {
  label: string
  id: string
  value?: string
  onChange: (value: string) => void
  error?: string
  /** Visual tone for the error state. Default `destructive` (red); opt
   *  in to `warning` (amber) for surfaces where validation reads as
   *  "needs attention" rather than a hard failure. */
  errorTone?: ErrorTone
  isRequired?: boolean
  subtitle?: string
  placeholder?: string
  type?: string
  disabled?: boolean
  readOnly?: boolean
  maxLength?: number
  className?: string
  min?: string
  max?: string
}

export const InputForm = ({
  label,
  id,
  value,
  onChange,
  error,
  errorTone = "destructive",
  subtitle,
  isRequired = false,
  type = "text",
  maxLength,
  readOnly,
  ...rest
}: InputFormProps) => {
  return (
    <FormInputWrapper>
      {(label || subtitle) && (
        <div className="flex flex-col gap-2">
          {label && (
            <LabelRequired htmlFor={id} isRequired={isRequired} className="flex">
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
      <Input
        type={type}
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        error={error}
        errorTone={errorTone}
        maxLength={maxLength}
        readOnly={readOnly}
        {...rest}
      />
      {error && (
        <p className={`${ERROR_TEXT_CLASS[errorTone]} text-sm`}>{error}</p>
      )}
    </FormInputWrapper>
  )
}
