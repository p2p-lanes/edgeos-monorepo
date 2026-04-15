import { X } from "lucide-react"
import { useState } from "react"

import { cn } from "@/lib/utils"

interface ChipInputProps {
  value: string[]
  onChange: (next: string[]) => void
}

export function ChipInput({ value, onChange }: ChipInputProps) {
  const [draft, setDraft] = useState("")

  const addTag = (raw: string) => {
    const tag = raw.trim().toLowerCase()
    if (!tag) return
    if (value.includes(tag)) {
      setDraft("")
      return
    }
    onChange([...value, tag])
    setDraft("")
  }

  const removeAt = (index: number) => {
    const next = value.slice()
    next.splice(index, 1)
    onChange(next)
  }

  return (
    <div
      className={cn(
        "flex min-h-9 w-80 flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-2 py-1.5",
        "focus-within:ring-[3px] focus-within:ring-ring/50 focus-within:border-ring",
      )}
    >
      {value.map((tag, index) => (
        <span
          key={`${tag}-${index}`}
          className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            className="opacity-70 hover:opacity-100"
            onClick={() => removeAt(index)}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
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
          }
        }}
        onBlur={() => {
          if (draft.trim()) addTag(draft)
        }}
        placeholder={value.length === 0 ? "Add tag..." : ""}
        className="flex-1 min-w-[80px] border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}
