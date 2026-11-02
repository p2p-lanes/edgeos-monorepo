"use client"

import { format } from "date-fns"
import { CalendarIcon, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type DayMatcher = (date: Date) => boolean

interface DatePickerProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** Matcher for individual calendar days (greys them out and blocks selection). */
  disabledDays?: DayMatcher
  /**
   * Days unselectable because of an external schedule (e.g. the selected
   * venue is closed). Same effect as `disabledDays` but rendered with a
   * distinct destructive color so the user can tell apart "outside the
   * booking window" from "venue closed that day".
   */
  closedDays?: DayMatcher
  placeholder?: string
  className?: string
  id?: string
  defaultMonth?: Date
  /** Shows a button that resets the value to "" so a saved date can be removed. */
  clearable?: boolean
}

/**
 * Date picker using shadcn Calendar.
 * Stores dates as YYYY-MM-DD format (for UTC midnight conversion).
 */
export function DatePicker({
  value,
  onChange,
  disabled,
  disabledDays,
  closedDays,
  placeholder = "Pick a date",
  className,
  id,
  defaultMonth,
  clearable,
}: DatePickerProps) {
  // Parse YYYY-MM-DD or ISO string to Date object
  const parseDate = (val: string): Date | undefined => {
    if (!val) return undefined
    // Extract just the date part and create date at noon to avoid timezone issues
    const datePart = val.slice(0, 10)
    const [year, month, day] = datePart.split("-").map(Number)
    return new Date(year, month - 1, day, 12, 0, 0)
  }

  // Format Date to YYYY-MM-DD string
  const formatDate = (date: Date | undefined): string => {
    if (!date) return ""
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }

  const date = parseDate(value)

  // Closed days are also unselectable — fold them into the disabled matcher
  // and additionally tag them with a "closed" modifier so they get a
  // destructive color (see modifiersClassNames). That visually separates
  // "outside booking window" from "venue closed that day" while still
  // blocking selection in both cases.
  const disabledMatcher: DayMatcher | undefined =
    disabledDays && closedDays
      ? (d) => disabledDays(d) || closedDays(d)
      : (disabledDays ?? closedDays)

  const picker = (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !date && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, "PPP") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          key={defaultMonth?.getTime()}
          mode="single"
          selected={date}
          defaultMonth={date ?? defaultMonth}
          onSelect={(newDate) => onChange(formatDate(newDate))}
          disabled={disabledMatcher}
          modifiers={closedDays ? { closed: closedDays } : undefined}
          modifiersClassNames={
            closedDays
              ? {
                  closed:
                    "!text-destructive/80 !opacity-100 line-through hover:bg-transparent",
                }
              : undefined
          }
          initialFocus
        />
      </PopoverContent>
    </Popover>
  )

  if (!clearable) return picker

  // Keep the wrapper mounted whether or not a date is set, so picking the
  // first date does not remount (and close) the popover.
  return (
    <div className="flex items-center gap-1">
      {picker}
      {date && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          onClick={() => onChange("")}
          aria-label="Clear date"
          title="Clear date"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
