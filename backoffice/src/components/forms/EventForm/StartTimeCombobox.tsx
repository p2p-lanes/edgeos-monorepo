import { useState } from "react"

import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface StartTimeComboboxProps {
  /** "YYYY-MM-DD" — required only to contextualize the popover header. */
  dateStr: string
  /** "HH:mm" — the currently selected time (in browser-local for this form). */
  value: string
  onChange: (hhmm: string) => void
  options: { label: string; isoUtc: string }[]
  disabled?: boolean
  fits: boolean
  placeholder?: string
}

export function StartTimeCombobox({
  value,
  onChange,
  options,
  disabled,
  fits,
  placeholder,
}: StartTimeComboboxProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="w-full">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div className="relative">
            <Input
              type="time"
              value={value}
              placeholder={placeholder}
              disabled={disabled}
              onFocus={() => {
                if (options.length > 0) setOpen(true)
              }}
              onChange={(e) => {
                const raw = e.target.value
                // Drop seconds if the browser provided any.
                onChange(raw ? raw.slice(0, 5) : "")
              }}
              className={cn(
                "w-full",
                !fits && value
                  ? "border-destructive focus-visible:ring-destructive/40"
                  : "",
              )}
            />
          </div>
        </PopoverTrigger>
        {options.length > 0 && (
          <PopoverContent
            align="start"
            className="w-[220px] p-1"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Suggested slots
            </p>
            <ul className="max-h-60 overflow-y-auto">
              {options.map((o) => (
                <li key={o.isoUtc}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                      value === o.label
                        ? "bg-accent text-accent-foreground"
                        : "",
                    )}
                    onClick={() => {
                      onChange(o.label)
                      setOpen(false)
                    }}
                  >
                    <span>{o.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        )}
      </Popover>
    </div>
  )
}
