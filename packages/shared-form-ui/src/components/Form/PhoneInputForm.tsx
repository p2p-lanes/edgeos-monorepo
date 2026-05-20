import { useEffect, useState } from "react"
import PhoneInput from "react-phone-number-input"
import type { Country } from "react-phone-number-input"
import "react-phone-number-input/style.css"
import { cn } from "../../utils"
import { FormInputWrapper } from "../FormInputWrapper"
import { LabelMuted, LabelRequired } from "../Label"

export interface PhoneInputFormProps {
  label: string
  id: string
  value?: string
  onChange: (value: string) => void
  error?: string
  isRequired?: boolean
  subtitle?: string
  placeholder?: string
  disabled?: boolean
}

const DEFAULT_COUNTRY: Country = "US" as Country

export const PhoneInputForm = ({
  label,
  id,
  value,
  onChange,
  error,
  isRequired = false,
  subtitle,
  placeholder,
  disabled,
}: PhoneInputFormProps) => {
  const [defaultCountry, setDefaultCountry] = useState<Country>(DEFAULT_COUNTRY)

  useEffect(() => {
    let cancelled = false
    fetch("https://ipapi.co/json/")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        const code = data.country_code
        if (typeof code === "string" && code.length === 2) {
          setDefaultCountry(code.toUpperCase() as Country)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

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
      <PhoneInput
        key={defaultCountry}
        id={id}
        international
        defaultCountry={defaultCountry}
        value={value || undefined}
        onChange={(v) => onChange(v ?? "")}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          "flex h-9 w-full items-center rounded-md border border-input bg-transparent px-3 text-base shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring md:text-sm",
          "[&_.PhoneInputInput]:bg-transparent [&_.PhoneInputInput]:text-foreground [&_.PhoneInputInput]:outline-none [&_.PhoneInputInput]:border-0 [&_.PhoneInputInput]:placeholder:text-muted-foreground",
          disabled && "bg-muted border-muted-foreground/50 cursor-not-allowed opacity-50",
          error && "border-red-500",
        )}
      />
      {error && <p className="text-red-500 text-sm">{error}</p>}
    </FormInputWrapper>
  )
}
