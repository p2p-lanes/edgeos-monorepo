"use client"

import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface DateTimePickerProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  id?: string
  defaultMonth?: Date
}

/**
 * DateTime picker combining shadcn Calendar with a time input.
 * Stores values as "YYYY-MM-DDTHH:mm" format (datetime-local compatible).
 */
export function DateTimePicker({
  value,
  onChange,
  disabled,
  placeholder = "Pick date & time",
  className,
  id,
  defaultMonth,
}: DateTimePickerProps) {
  const datePart = value?.slice(0, 10) ?? ""
  const timePart = value?.slice(11, 16) ?? "12:00"

  const parseDate = (val: string): Date | undefined => {
    if (!val) return undefined
    const [year, month, day] = val.split("-").map(Number)
    return new Date(year, month - 1, day, 12, 0, 0)
  }

  const formatDate = (date: Date | undefined): string => {
    if (!date) return ""
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }

  const date = parseDate(datePart)

  const handleDateChange = (newDate: Date | undefined) => {
    const d = formatDate(newDate)
    if (d) {
      onChange(`${d}T${timePart || "12:00"}`)
    }
  }

  const handleTimeChange = (newTime: string) => {
    if (datePart) {
      onChange(`${datePart}T${newTime}`)
    } else {
      const today = formatDate(new Date())
      onChange(`${today}T${newTime}`)
    }
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            disabled={disabled}
            className={cn(
              "flex-1 justify-start text-left font-normal",
              !date && "text-muted-foreground",
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
            onSelect={handleDateChange}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      <Input
        type="time"
        value={timePart}
        onChange={(e) => handleTimeChange(e.target.value)}
        disabled={disabled}
        className="w-[110px] shrink-0"
      />
    </div>
  )
}
