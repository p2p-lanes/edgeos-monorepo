"use client"

import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"

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
  /** `YYYY-MM-DD` or any ISO date string (the first 10 chars are used). */
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** Matcher for individual days — greys them out and blocks selection. */
  disabledDays?: DayMatcher
  /**
   * Days that are blocked because of an external schedule (e.g. the
   * selected venue is closed). Same effect as `disabledDays` (unselectable)
   * but rendered with a distinct color so the user can tell apart "outside
   * the booking window" from "venue is closed that day".
   */
  closedDays?: DayMatcher
  placeholder?: string
  className?: string
  id?: string
  defaultMonth?: Date
}

/**
 * Themed date picker matching the portal's design tokens. Mirrors the
 * backoffice DatePicker (same props, same storage shape) so the two
 * apps behave identically around date input.
 *
 * Stores selection as ``YYYY-MM-DD`` — safe to combine with a local
 * time string when converting to UTC through the popup's timezone.
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
}: DatePickerProps) {
  // Parse ``YYYY-MM-DD`` (or the first 10 chars of any ISO string) at noon
  // local time — noon dodges the DST edge cases that midnight hits.
  const parseDate = (val: string): Date | undefined => {
    if (!val) return undefined
    const [year, month, day] = val.slice(0, 10).split("-").map(Number)
    if (!year || !month || !day) return undefined
    return new Date(year, month - 1, day, 12, 0, 0)
  }

  const formatDate = (date: Date | undefined): string => {
    if (!date) return ""
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }

  const date = parseDate(value)

  // Closed days are also unselectable, so fold them into the disabled
  // matcher. We additionally tag them with a custom "closed" modifier so
  // they get a distinct color (see modifiersClassNames below) — that way
  // "outside booking window" and "venue closed" are visually different
  // even though both block selection.
  const disabledMatcher: DayMatcher | undefined =
    disabledDays && closedDays
      ? (d) => disabledDays(d) || closedDays(d)
      : (disabledDays ?? closedDays)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !date && "text-muted-foreground",
            className,
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
                  // `!` prefix forces these to win over the built-in
                  // `disabled` modifier classes (text-muted-foreground /
                  // opacity-50) regardless of CSS source order — the
                  // Calendar concatenates classes without tailwind-merge.
                  closed:
                    "!text-destructive/80 !opacity-100 line-through hover:bg-transparent",
                }
              : undefined
          }
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}
