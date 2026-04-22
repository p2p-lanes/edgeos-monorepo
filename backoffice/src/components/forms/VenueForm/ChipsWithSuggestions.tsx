import { X } from "lucide-react"
import { useMemo, useState } from "react"

interface ChipsWithSuggestionsProps {
  value: string[]
  onChange: (next: string[]) => void
  suggestions: string[]
  placeholder?: string
  disabled?: boolean
}

export function ChipsWithSuggestions({
  value,
  onChange,
  suggestions,
  placeholder,
  disabled,
}: ChipsWithSuggestionsProps) {
  const [draft, setDraft] = useState("")
  const [open, setOpen] = useState(false)

  const normalized = draft.trim().toLowerCase()
  const filtered = useMemo(() => {
    const selected = new Set(value)
    return suggestions
      .filter((s) => !selected.has(s))
      .filter((s) => (normalized ? s.toLowerCase().includes(normalized) : true))
      .slice(0, 8)
  }, [suggestions, value, normalized])

  const addTag = (raw: string) => {
    if (disabled) return
    const tag = raw.trim().toLowerCase()
    if (!tag || value.includes(tag)) {
      setDraft("")
      return
    }
    onChange([...value, tag])
    setDraft("")
  }

  const removeAt = (index: number) => {
    if (disabled) return
    const next = value.slice()
    next.splice(index, 1)
    onChange(next)
  }

  return (
    <div className="relative w-80">
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-2 py-1.5 focus-within:ring-[3px] focus-within:ring-ring/50 focus-within:border-ring">
        {value.map((tag, index) => (
          <span
            key={`${tag}-${index}`}
            className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              className="opacity-70 hover:opacity-100 disabled:opacity-40"
              onClick={() => removeAt(index)}
              disabled={disabled}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay so click on suggestion fires first.
            setTimeout(() => setOpen(false), 120)
            if (draft.trim()) addTag(draft)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              addTag(draft)
            } else if (e.key === "Backspace" && !draft && value.length > 0) {
              e.preventDefault()
              removeAt(value.length - 1)
            } else if (e.key === "," || e.key === "Tab") {
              if (draft.trim()) {
                e.preventDefault()
                addTag(draft)
              }
            } else if (e.key === "Escape") {
              setOpen(false)
            }
          }}
          placeholder={value.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[80px] border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
          <ul className="max-h-48 overflow-auto py-1 text-sm">
            {filtered.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  className="flex w-full items-center px-3 py-1.5 hover:bg-accent hover:text-accent-foreground"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    addTag(s)
                  }}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
