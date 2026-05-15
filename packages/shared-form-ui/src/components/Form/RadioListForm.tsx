"use client"

import { cn } from "../../utils"
import { FormInputWrapper } from "../FormInputWrapper"
import { LabelRequired } from "../Label"
import { RadioGroup, RadioGroupItem } from "../RadioGroup"

export interface RadioListFormProps {
  label?: string
  id: string
  value: string
  onChange: (value: string) => void
  options: string[]
  isRequired?: boolean
  subtitle?: string
  disabled?: boolean
  error?: string
}

export function RadioListForm({
  label,
  id,
  value,
  onChange,
  options,
  isRequired = false,
  subtitle,
  disabled = false,
  error,
}: RadioListFormProps) {
  const groupId = `${id}-radio-list`
  return (
    <FormInputWrapper>
      {(label || subtitle) && (
        <>
          {label && (
            <LabelRequired isRequired={isRequired} id={`${groupId}-label`}>
              {label}
            </LabelRequired>
          )}
          {subtitle && (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </>
      )}
      <RadioGroup
        value={value}
        onValueChange={onChange}
        className="mt-2 flex flex-col gap-2"
        role="radiogroup"
        aria-labelledby={`${groupId}-label`}
        disabled={disabled}
      >
        {options.map((option) => {
          const optionId = `${id}-${option.replace(/\s+/g, "-")}`
          const isSelected = value === option
          return (
            <label
              key={option}
              className={cn(
                "flex cursor-pointer items-center gap-3",
                disabled && "cursor-not-allowed opacity-60",
              )}
              htmlFor={optionId}
            >
              <RadioGroupItem
                value={option}
                id={optionId}
                className="shrink-0"
                aria-checked={isSelected}
                disabled={disabled}
              />
              <span className="text-sm">{option}</span>
            </label>
          )
        })}
      </RadioGroup>
      {error && (
        <p className="mt-1 text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
    </FormInputWrapper>
  )
}
