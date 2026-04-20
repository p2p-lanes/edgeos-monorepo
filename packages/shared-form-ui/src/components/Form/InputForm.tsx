import { FormInputWrapper } from "../FormInputWrapper"
import { Input } from "../Input"
import { LabelMuted, LabelRequired } from "../Label"

export interface InputFormProps {
  label: string
  id: string
  value?: string
  onChange: (value: string) => void
  error?: string
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
        maxLength={maxLength}
        readOnly={readOnly}
        {...rest}
      />
      {error && <p className="text-red-500 text-sm">{error}</p>}
    </FormInputWrapper>
  )
}
