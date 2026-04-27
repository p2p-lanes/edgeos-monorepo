import { X } from "lucide-react"
import { useState } from "react"

import { cn } from "@/lib/utils"

interface ChipInputProps {
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  placeholder?: string
}

export function ChipInput({
  value,
  onChange,
  disabled,
  placeholder,
}: ChipInputProps) {
  const [draft, setDraft] = useState("")

  // Add one or more comma-separated values in a single state update so
  // pasting "a, b, c" then pressing Enter creates 3 chips at once.
  const addMany = (raw: string) => {
    if (disabled) return
    const incoming = raw
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
    if (incoming.length === 0) {
      setDraft("")
      return
    }
    const seen = new Set(value)
    const next = [...value]
    for (const tag of incoming) {
      if (seen.has(tag)) continue
      seen.add(tag)
      next.push(tag)
    }
    if (next.length !== value.length) onChange(next)
    setDraft("")
  }

  const removeAt = (index: number) => {
    if (disabled) return
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
        onChange={(e) => setDraft(e.target.value)}
        disabled={disabled}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            addMany(draft)
          } else if (e.key === "Backspace" && !draft && value.length > 0) {
            e.preventDefault()
            removeAt(value.length - 1)
          } else if (e.key === "Tab") {
            if (draft.trim()) {
              e.preventDefault()
              addMany(draft)
            }
          }
        }}
        onPaste={(e) => {
          // If the pasted text contains a comma, eagerly split into chips.
          // Otherwise let the paste land in the draft normally so the user
          // can keep typing.
          const text = e.clipboardData.getData("text")
          if (text.includes(",")) {
            e.preventDefault()
            addMany(`${draft}${text}`)
          }
        }}
        onBlur={() => {
          if (draft.trim()) addMany(draft)
        }}
        placeholder={
          value.length === 0
            ? (placeholder ?? "Add tag (or paste a, b, c)")
            : ""
        }
        className="flex-1 min-w-[80px] border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}
