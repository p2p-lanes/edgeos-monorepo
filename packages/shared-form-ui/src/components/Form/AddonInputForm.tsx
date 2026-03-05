import { AddonInput } from "../AddonInput"
import { FormInputWrapper } from "../FormInputWrapper"
import { LabelMuted, LabelRequired } from "../Label"

export interface AddonInputFormProps {
  label: string
  id: string
  value?: string
  onChange: (value: string) => void
  error?: string
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
        className={error ? "border-red-500" : ""}
      />
      {error && <p className="text-red-500 text-sm">{error}</p>}
    </FormInputWrapper>
  )
}
