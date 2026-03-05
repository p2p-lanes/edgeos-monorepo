import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
            <SelectValue
              placeholder={placeholder}
              className="text-sm text-muted-foreground"
            />
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
