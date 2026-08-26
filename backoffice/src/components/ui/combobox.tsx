import { Check, ChevronsUpDown } from "lucide-react"
import { type ReactNode, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface ComboboxOption {
  value: string
  /** Text shown on the trigger, and the default item body. */
  label: string
  /** Extra searchable text (country, aliases, offset…). */
  keywords?: string
  /** Heading this option sits under while the query is empty. */
  group?: string
  /** Custom item body — falls back to `label`. */
  item?: ReactNode
  disabled?: boolean
}

interface ComboboxProps {
  options: ComboboxOption[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  className?: string
  contentClassName?: string
  /** Accessible name for the trigger when there is no visible label. */
  "aria-label"?: string
}

function haystack(option: ComboboxOption): string {
  return `${option.label} ${option.keywords ?? ""}`.toLowerCase()
}

/**
 * Popover + Command single-select, the shape the backoffice already uses for
 * `StartTimeSelect`. Filtering is ours rather than cmdk's: cmdk scores fuzzily,
 * which turns a long list (every IANA timezone) into noise. Here every
 * whitespace-separated token has to appear somewhere in label + keywords, so
 * "buenos aires", "es madrid" and "gmt-3" all narrow instead of widening.
 */
export function Combobox({
  options,
  value,
  onChange,
  disabled,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyMessage = "No results.",
  className,
  contentClassName,
  "aria-label": ariaLabel,
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")

  const selected = options.find((o) => o.value === value)

  const tokens = useMemo(
    () => query.toLowerCase().trim().split(/\s+/).filter(Boolean),
    [query],
  )

  const matches = useMemo(() => {
    if (tokens.length === 0) return options
    return options.filter((option) => {
      const text = haystack(option)
      return tokens.every((token) => text.includes(token))
    })
  }, [options, tokens])

  // Headings only make sense on the unfiltered list; once the operator types,
  // a flat list of hits reads better than a dozen one-row groups.
  const groups = useMemo(() => {
    if (tokens.length > 0) return null
    const byGroup = new Map<string, ComboboxOption[]>()
    for (const option of matches) {
      const key = option.group ?? ""
      const bucket = byGroup.get(key)
      if (bucket) bucket.push(option)
      else byGroup.set(key, [option])
    }
    return [...byGroup.entries()]
  }, [matches, tokens])

  const pick = (next: string) => {
    onChange(next)
    setOpen(false)
    setQuery("")
  }

  const renderItem = (option: ComboboxOption) => (
    <CommandItem
      key={option.value}
      value={option.value}
      disabled={option.disabled}
      onSelect={() => pick(option.value)}
    >
      <Check
        className={cn(
          "mr-2 h-4 w-4 shrink-0",
          option.value === value ? "opacity-100" : "opacity-0",
        )}
      />
      {option.item ?? option.label}
    </CommandItem>
  )

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery("")
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{selected?.label ?? placeholder}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          "w-(--radix-popover-trigger-width) min-w-[16rem] p-0",
          contentClassName,
        )}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-72">
            {/* Not CommandEmpty: with shouldFilter off, cmdk's own empty
                state keys off a filter we never run. */}
            {matches.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </div>
            )}
            {groups
              ? groups.map(([heading, items]) => (
                  <CommandGroup key={heading} heading={heading || undefined}>
                    {items.map(renderItem)}
                  </CommandGroup>
                ))
              : matches.map(renderItem)}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
