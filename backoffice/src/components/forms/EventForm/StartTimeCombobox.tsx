import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface StartTimeComboboxProps {
  /** "HH:mm" — the currently selected time (in browser-local for this form). */
  value: string
  onChange: (hhmm: string) => void
  disabled?: boolean
  /** Whether the start + duration fits the venue's open intervals. */
  fits: boolean
  placeholder?: string
}

export function StartTimeCombobox({
  value,
  onChange,
  disabled,
  fits,
  placeholder,
}: StartTimeComboboxProps) {
  return (
    <Input
      type="time"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
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
  )
}
