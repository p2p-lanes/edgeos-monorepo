"use client"

import { ChevronDown, Search, X } from "lucide-react"
import { useMemo, useState } from "react"
import type { MultiSelectDetailedConfig } from "../../types"
import { cn } from "../../utils"
import { Checkbox } from "../Checkbox"
import { FormInputWrapper } from "../FormInputWrapper"
import { LabelRequired } from "../Label"
import { Popover, PopoverContent, PopoverTrigger } from "../Popover"

export interface MultiSelectDetailedFormProps {
  label?: string
  id: string
  value: string[]
  onChange: (value: string[]) => void
  options: string[]
  config?: MultiSelectDetailedConfig
  isRequired?: boolean
  subtitle?: string
  placeholder?: string
  disabled?: boolean
  error?: string
}

export function MultiSelectDetailedForm({
  label,
  id,
  value,
  onChange,
  options,
  config,
  isRequired = false,
  subtitle,
  placeholder = "Select options...",
  disabled = false,
  error,
}: MultiSelectDetailedFormProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const subtitles = config?.subtitles ?? {}
  const minSel = config?.min_selections ?? undefined
  const maxSel = config?.max_selections ?? undefined

  const selected = Array.isArray(value) ? value : []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((opt) => {
      const sub = subtitles[opt] ?? ""
      return (
        opt.toLowerCase().includes(q) || sub.toLowerCase().includes(q)
      )
    })
  }, [options, query, subtitles])

  const toggle = (option: string) => {
    if (disabled) return
    if (selected.includes(option)) {
      onChange(selected.filter((v) => v !== option))
      return
    }
    if (typeof maxSel === "number" && selected.length >= maxSel) return
    onChange([...selected, option])
  }

  const remove = (option: string) => {
    if (disabled) return
    onChange(selected.filter((v) => v !== option))
  }

  const helperText = (() => {
    const hasMin = typeof minSel === "number" && minSel > 0
    const hasMax = typeof maxSel === "number" && maxSel > 0
    if (hasMin && hasMax) return `Select between ${minSel} and ${maxSel} options`
    if (hasMin) return `Select at least ${minSel}`
    if (hasMax) return `Select up to ${maxSel}`
    return null
  })()

  const belowMin =
    typeof minSel === "number" && minSel > 0 && selected.length < minSel

  return (
    <FormInputWrapper>
      {(label || subtitle) && (
        <>
          {label && (
            <LabelRequired isRequired={isRequired}>{label}</LabelRequired>
          )}
          {subtitle && (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </>
      )}
      <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            className={cn(
              "flex w-full min-h-9 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              error && "border-red-500",
            )}
          >
            <div className="flex flex-1 flex-wrap items-center gap-1.5">
              {selected.length === 0 && (
                <span className="text-muted-foreground">{placeholder}</span>
              )}
              {selected.map((opt) => (
                <span
                  key={opt}
                  className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground"
                >
                  <span>{opt}</span>
                  <span
                    role="button"
                    aria-label={`Remove ${opt}`}
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      remove(opt)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        e.stopPropagation()
                        remove(opt)
                      }
                    }}
                    className="inline-flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full hover:bg-primary-foreground/20"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </span>
                </span>
              ))}
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="flex w-[--radix-popover-trigger-width] flex-col overflow-hidden p-0"
          style={{
            maxHeight:
              "min(var(--radix-popover-content-available-height), 20rem)",
          }}
          align="start"
        >
          <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              aria-label="Search options"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                No options found
              </div>
            )}
            {filtered.map((option) => {
              const isSelected = selected.includes(option)
              const reachedMax =
                typeof maxSel === "number" && selected.length >= maxSel
              const isDisabled = !isSelected && reachedMax
              return (
                <button
                  type="button"
                  key={option}
                  onClick={() => toggle(option)}
                  disabled={isDisabled}
                  aria-pressed={isSelected}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent",
                    isDisabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                  )}
                >
                  <Checkbox
                    checked={isSelected}
                    tabIndex={-1}
                    aria-hidden
                    className="mt-0.5 pointer-events-none"
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold leading-tight break-words">
                      {option}
                    </span>
                    {subtitles[option] && (
                      <span className="text-xs text-muted-foreground break-words">
                        {subtitles[option]}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
      {helperText && (
        <p
          className={cn(
            "text-xs text-muted-foreground",
            belowMin && "text-red-500",
          )}
        >
          {helperText}
        </p>
      )}
      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
    </FormInputWrapper>
  )
}
