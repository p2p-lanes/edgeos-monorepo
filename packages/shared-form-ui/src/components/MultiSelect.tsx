"use client"

import { Eye, EyeOff } from "lucide-react"
import React, { useEffect, useState } from "react"
import { cn } from "../utils"

export interface MultiSelectOption {
  value: string
  label: string
}

export interface MultiSelectProps {
  options: MultiSelectOption[]
  onChange: (selectedValues: string[]) => void
  defaultValue?: string[]
  value?: string[]
  disabled?: boolean
  className?: string
  "aria-label"?: string
}

export function MultiSelect({
  options,
  onChange,
  defaultValue,
  value: controlledValue,
  disabled = false,
  className,
  "aria-label": ariaLabel = "Multiple selection",
}: MultiSelectProps) {
  const isControlled = controlledValue !== undefined
  const [internalValue, setInternalValue] = useState<string[]>(
    defaultValue ?? controlledValue ?? [],
  )
  const selectedValues = isControlled ? controlledValue : internalValue

  useEffect(() => {
    if (isControlled) return
    onChange(internalValue)
  }, [internalValue, isControlled, onChange])

  const handleToggle = (optionValue: string) => {
    const next = selectedValues.includes(optionValue)
      ? selectedValues.filter((item) => item !== optionValue)
      : [...selectedValues, optionValue]
    if (!isControlled) setInternalValue(next)
    onChange(next)
  }

  const handleKeyDown = (e: React.KeyboardEvent, optionValue: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      handleToggle(optionValue)
    }
  }

  return (
    <div
      className={cn("w-full max-w-2xl", className)}
      role="group"
      aria-label={ariaLabel}
    >
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isSelected = selectedValues.includes(option.value)
          return (
            <button
              type="button"
              key={option.value}
              onClick={() => handleToggle(option.value)}
              onKeyDown={(e) => handleKeyDown(e, option.value)}
              disabled={disabled}
              aria-pressed={isSelected}
              aria-label={`${option.label}, ${isSelected ? "selected" : "not selected"}`}
              tabIndex={0}
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium cursor-pointer transition-colors border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border-input bg-white text-gray-700 hover:bg-muted hover:text-foreground",
              )}
            >
              <span>{option.label}</span>
              {isSelected ? (
                <EyeOff className="h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <Eye className="h-4 w-4 shrink-0" aria-hidden />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
