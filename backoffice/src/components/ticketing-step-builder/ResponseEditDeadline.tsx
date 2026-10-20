import { format, isValid, parse } from "date-fns"
import { CalendarIcon, Clock } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { TimePicker } from "@/components/ui/time-picker"

/** Wall-clock values interpreted by the caller in the gathering's time zone. */
export function ResponseEditDeadline({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [date = "", time = ""] = value.split("T")
  const parsed = parse(date, "yyyy-MM-dd", new Date())
  const selected = isValid(parsed) ? parsed : undefined

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="response-edit-date">Deadline date</Label>
        <div className="flex gap-1">
          <Input
            id="response-edit-date"
            placeholder="YYYY-MM-DD"
            value={date}
            onChange={(e) => onChange(`${e.target.value}T${time}`)}
            autoComplete="off"
          />
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label="Choose deadline date"
                className="shrink-0"
              >
                <CalendarIcon className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selected}
                defaultMonth={selected}
                onSelect={(day) =>
                  onChange(`${day ? format(day, "yyyy-MM-dd") : ""}T${time}`)
                }
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="response-edit-time">Deadline time</Label>
        <div className="flex gap-1">
          <Input
            id="response-edit-time"
            placeholder="HH:mm"
            value={time}
            onChange={(e) => onChange(`${date}T${e.target.value}`)}
            autoComplete="off"
          />
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label="Choose deadline time"
                className="shrink-0"
              >
                <Clock className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto" align="start">
              <TimePicker
                step={1}
                value={/^\d{2}:\d{2}$/.test(time) ? time : ""}
                onChange={(next) => onChange(`${date}T${next}`)}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  )
}
