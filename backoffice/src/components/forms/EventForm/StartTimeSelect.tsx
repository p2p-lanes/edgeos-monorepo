import { Check, ChevronsUpDown, Clock } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
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

export interface TimeOption {
  /** "HH:mm" wall-clock label in the popup timezone. */
  label: string
  /** False when the slot is inside open hours but the event doesn't fit
   *  there (occupied, or the duration overruns the open window). */
  free: boolean
}

interface StartTimeSelectProps {
  /** "HH:mm" — the currently selected time. */
  value: string
  onChange: (hhmm: string) => void
  /**
   * Slots to offer. With a venue selected these are only the times inside
   * the venue's open hours (occupied ones grayed out); without a venue the
   * caller passes a generic all-day list.
   */
  options: TimeOption[]
  disabled?: boolean
  /** Whether the start + duration fits the venue's open intervals. */
  fits: boolean
  placeholder?: string
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/

/**
 * Start-time combobox styled like the rest of the backoffice (Popover +
 * Command) — replaces the native <input type="time"> widget. Lists the
 * venue's bookable slots, renders occupied ones grayed out, and still
 * accepts a free-typed "HH:mm" for times between steps.
 */
export function StartTimeSelect({
  value,
  onChange,
  options,
  disabled,
  fits,
  placeholder,
}: StartTimeSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")

  // A typed time that parses but isn't one of the listed slots gets its own
  // selectable entry, so "Pick or type a time" keeps working (e.g. 09:15
  // between 30-minute steps).
  const typedTime = useMemo(() => {
    const m = query.trim().match(TIME_RE)
    if (!m) return null
    const hhmm = `${m[1].padStart(2, "0")}:${m[2]}`
    return options.some((o) => o.label === hhmm) ? null : hhmm
  }, [query, options])

  const pick = (hhmm: string) => {
    onChange(hhmm)
    setOpen(false)
    setQuery("")
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !value && "text-muted-foreground",
            !fits && value
              ? "border-destructive focus-visible:ring-destructive/40"
              : "",
          )}
        >
          <span className="inline-flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            {value || placeholder || "Pick a time"}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0" align="end">
        <Command>
          <CommandInput
            placeholder="Type HH:mm…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-60">
            <CommandEmpty>
              {options.length === 0
                ? (placeholder ?? "No open hours")
                : "No matching time."}
            </CommandEmpty>
            {typedTime && (
              <CommandGroup>
                <CommandItem
                  value={`custom-${typedTime}`}
                  onSelect={() => pick(typedTime)}
                >
                  <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
                  Use {typedTime}
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt.label}
                  value={opt.label}
                  disabled={!opt.free}
                  onSelect={() => pick(opt.label)}
                  className={cn(
                    !opt.free &&
                      "text-muted-foreground/50 line-through data-[disabled=true]:opacity-60",
                  )}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === opt.label ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {opt.label}
                  {!opt.free && (
                    <span className="ml-auto text-[10px] font-medium uppercase tracking-wide no-underline">
                      Busy
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
