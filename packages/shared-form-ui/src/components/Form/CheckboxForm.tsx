import { Checkbox } from "../Checkbox"
import { FormInputWrapper } from "../FormInputWrapper"
import type { ErrorTone } from "../Input"
import { LabelMuted, LabelRequired } from "../Label"

const ERROR_TEXT_CLASS: Record<ErrorTone, string> = {
  destructive: "text-red-500",
  warning: "text-amber-600",
}

export interface CheckboxFormProps {
  label?: string
  id: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  defaultChecked?: boolean
  value?: string
  required?: boolean
  subtitle?: string
  title?: string
  error?: string
  /** Visual tone for the error state. Default `destructive` (red); opt
   *  in to `warning` (amber). */
  errorTone?: ErrorTone
}

export const CheckboxForm = ({
  label,
  id,
  checked,
  onCheckedChange,
  disabled,
  defaultChecked,
  value,
  required,
  subtitle,
  title,
  error,
  errorTone = "destructive",
}: CheckboxFormProps) => {
  return (
    <FormInputWrapper>
      {title && <LabelRequired isRequired={required}>{title}</LabelRequired>}
      {subtitle && (
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      )}
      <div className="flex items-center space-x-2 my-2">
        <Checkbox
          id={id}
          checked={checked}
          value={value}
          onCheckedChange={(checked: boolean) => onCheckedChange(checked)}
          disabled={disabled}
          defaultChecked={defaultChecked}
          required={required}
        />
        {label && (
          <LabelMuted htmlFor={id} className="cursor-pointer">
            {label}
          </LabelMuted>
        )}
      </div>
      {error && (
        <p className={`${ERROR_TEXT_CLASS[errorTone]} text-sm`}>{error}</p>
      )}
    </FormInputWrapper>
  )
}
