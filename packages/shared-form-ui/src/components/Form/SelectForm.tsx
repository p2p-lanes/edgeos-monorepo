import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../Select"
import { FormInputWrapper } from "../FormInputWrapper"
import type { ErrorTone } from "../Input"
import { LabelRequired } from "../Label"

const ERROR_BORDER_CLASS: Record<ErrorTone, string> = {
  destructive: "border-red-500",
  warning: "border-amber-500",
}
const ERROR_TEXT_CLASS: Record<ErrorTone, string> = {
  destructive: "text-red-500",
  warning: "text-amber-600",
}

export interface SelectFormProps {
  label: string
  id: string
  value: string
  onChange: (value: string) => void
  error?: string
  /** Visual tone for the error state. Default `destructive` (red); opt
   *  in to `warning` (amber). */
  errorTone?: ErrorTone
  isRequired?: boolean
  placeholder?: string
  options: { value: string; label: string }[]
  disabled?: boolean
}

export const SelectForm = ({
  label,
  id,
  value,
  onChange,
  error,
  errorTone = "destructive",
  isRequired = false,
  placeholder,
  options,
  disabled = false,
}: SelectFormProps) => {
  return (
    <FormInputWrapper>
      <div className="space-y-1">
        {label && (
          <LabelRequired htmlFor={id} isRequired={isRequired}>
            {label}
          </LabelRequired>
        )}
        <Select onValueChange={onChange} value={value} disabled={disabled}>
          <SelectTrigger
            id={id}
            className={error ? ERROR_BORDER_CLASS[errorTone] : ""}
            disabled={disabled}
          >
            <span className="flex-1 truncate text-left text-sm">
              {value ? (
                (options.find((o) => o.value === value)?.label ?? value)
              ) : (
                <span className="text-muted-foreground">{placeholder}</span>
              )}
            </span>
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && (
        <p className={`${ERROR_TEXT_CLASS[errorTone]} text-sm mt-1`}>{error}</p>
      )}
    </FormInputWrapper>
  )
}
