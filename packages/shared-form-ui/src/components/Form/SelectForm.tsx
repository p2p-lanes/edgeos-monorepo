import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../Select"
import { FormInputWrapper } from "../FormInputWrapper"
import { LabelRequired } from "../Label"

export interface SelectFormProps {
  label: string
  id: string
  value: string
  onChange: (value: string) => void
  error?: string
  isRequired?: boolean
  placeholder?: string
  options: { value: string; label: string }[]
}

export const SelectForm = ({
  label,
  id,
  value,
  onChange,
  error,
  isRequired = false,
  placeholder,
  options,
}: SelectFormProps) => {
  return (
    <FormInputWrapper>
      <div className="space-y-1">
        {label && (
          <LabelRequired htmlFor={id} isRequired={isRequired}>
            {label}
          </LabelRequired>
        )}
        <Select onValueChange={onChange} value={value}>
          <SelectTrigger id={id} className={error ? "border-red-500" : ""}>
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
      {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
    </FormInputWrapper>
  )
}
