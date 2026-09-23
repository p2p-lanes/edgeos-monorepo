"use client"

import { Check, ChevronDown, Search, X } from "lucide-react"
import { useMemo, useState } from "react"
import type { MultiSelectDetailedConfig } from "../../types"
import { cn } from "../../utils"
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
  portalContentClassName?: string
  labels?: {
    placeholder: string
    search: string
    searchLabel: string
    empty: string
    selected?: (count: number) => string
    remove: (option: string) => string
    between: (min: number, max: number) => string
    atLeast: (min: number) => string
    upTo: (max: number) => string
  }
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
  placeholder,
  disabled = false,
  error,
  portalContentClassName,
  labels,
}: MultiSelectDetailedFormProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const subtitles = config?.subtitles ?? {}
  const minSel = config?.min_selections ?? undefined
  const maxSel = config?.max_selections ?? undefined
  const placeholderText =
    placeholder ?? labels?.placeholder ?? "Select options..."

  const selected = Array.isArray(value) ? value : []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((opt) => {
      const sub = subtitles[opt] ?? ""
      return opt.toLowerCase().includes(q) || sub.toLowerCase().includes(q)
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
    if (hasMin && hasMax)
      return (
        labels?.between(minSel, maxSel) ??
        `Select between ${minSel} and ${maxSel} options`
      )
    if (hasMin) return labels?.atLeast(minSel) ?? `Select at least ${minSel}`
    if (hasMax) return labels?.upTo(maxSel) ?? `Select up to ${maxSel}`
    return null
  })()

  const belowMin =
    typeof minSel === "number" && minSel > 0 && selected.length < minSel

  return (
    <FormInputWrapper>
      {(label || subtitle) && (
        <>
          {label && (
            <LabelRequired htmlFor={id} isRequired={isRequired}>
              {label}
            </LabelRequired>
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
            aria-haspopup="dialog"
            aria-expanded={open}
            className={cn(
              "flex w-full min-h-9 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1.5 text-left text-sm shadow-sm ring-offset-background transition-colors hover:border-ring/40 focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              error && "border-red-500",
            )}
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                selected.length === 0 && "text-muted-foreground",
              )}
            >
              {selected.length === 0
                ? placeholderText
                : (labels?.selected?.(selected.length) ??
                  `${selected.length} selected`)}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className={cn(
            "flex w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border-border p-0 shadow-lg",
            portalContentClassName,
          )}
          style={{
            maxHeight:
              "min(var(--radix-popover-content-available-height), 20rem)",
          }}
          align="start"
          aria-label={label || placeholderText}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-3">
            <Search
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={labels?.search ?? "Search..."}
              className="min-w-0 flex-1 bg-transparent text-sm text-popover-foreground outline-none placeholder:text-muted-foreground"
              aria-label={labels?.searchLabel ?? "Search options"}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent]">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                {labels?.empty ?? "No options found"}
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
                    "flex w-full cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                    isSelected && "bg-accent text-accent-foreground",
                    isDisabled &&
                      "cursor-not-allowed opacity-50 hover:bg-transparent",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-popover",
                    )}
                  >
                    {isSelected && <Check className="h-3 w-3" />}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-medium leading-5 break-words">
                      {option}
                    </span>
                    {subtitles[option] && (
                      <span className="text-xs leading-relaxed text-muted-foreground break-words">
                        {subtitles[option]}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((option) => (
            <span
              key={option}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-input bg-muted/50 py-1 pl-2.5 pr-1.5 text-xs font-medium text-foreground"
            >
              <span className="min-w-0 break-words">{option}</span>
              <button
                type="button"
                aria-label={labels?.remove(option) ?? `Remove ${option}`}
                disabled={disabled}
                onClick={() => remove(option)}
                className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
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
