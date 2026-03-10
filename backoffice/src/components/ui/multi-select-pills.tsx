"use client"

import { Check, Circle, Eye, EyeOff } from "lucide-react"
import { cn } from "@/lib/utils"

export interface MultiSelectPillsOption {
  value: string
  label: string
}

interface MultiSelectPillsProps {
  options: MultiSelectPillsOption[]
  value: string[]
  onChange: (selectedValues: string[]) => void
  valueLabel?: "eye" | "check"
  "aria-label"?: string
}

const VALUE_LABEL_ICONS = {
  check: { selected: Check, unselected: Circle },
  eye: { selected: EyeOff, unselected: Eye },
} as const

export function MultiSelectPills({
  options,
  value,
  onChange,
  valueLabel = "check",
  "aria-label": ariaLabel = "Multiple selection",
}: MultiSelectPillsProps) {
  const icons = VALUE_LABEL_ICONS[valueLabel]
  const IconSelected = icons.selected
  const IconUnselected = icons.unselected

  const handleToggle = (optionValue: string) => {
    const next = value.includes(optionValue)
      ? value.filter((v) => v !== optionValue)
      : [...value, optionValue]
    onChange(next)
  }

  const handleKeyDown = (
    e: React.KeyboardEvent,
    optionValue: string,
  ) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      handleToggle(optionValue)
    }
  }

  return (
    <div
      className="flex flex-wrap gap-2"
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const isSelected = value.includes(option.value)
        return (
          <button
            type="button"
            key={option.value}
            onClick={() => handleToggle(option.value)}
            onKeyDown={(e) => handleKeyDown(e, option.value)}
            aria-pressed={isSelected}
            aria-label={`${option.label}, ${isSelected ? "selected" : "not selected"}`}
            tabIndex={0}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              "border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isSelected
                ? "border-input bg-primary text-primary-foreground hover:bg-primary/90"
                : "border-input bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span>{option.label}</span>
            {isSelected ? (
              <IconSelected className="h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <IconUnselected className="h-4 w-4 shrink-0" aria-hidden />
            )}
          </button>
        )
      })}
    </div>
  )
}
