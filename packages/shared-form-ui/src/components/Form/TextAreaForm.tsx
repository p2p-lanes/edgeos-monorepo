import { FormInputWrapper } from "../FormInputWrapper"
import { LabelMuted, LabelRequired } from "../Label"
import { Textarea } from "../Textarea"

export interface TextAreaFormProps {
  label: string
  id: string
  value: string
  handleChange: (value: string) => void
  error: string
  isRequired?: boolean
  subtitle?: string
  placeholder?: string
}

export const TextAreaForm = ({
  label,
  id,
  value,
  error,
  handleChange,
  isRequired,
  subtitle,
  placeholder,
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
        className={`min-h-[72px] mt-2 ${error ? "border-red-500" : ""}`}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
      />
      {error && <p className="text-red-500 text-sm">{error}</p>}
    </FormInputWrapper>
  )
}
