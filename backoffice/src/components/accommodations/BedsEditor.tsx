import { Minus, Plus, X } from "lucide-react"
import type { BedType } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { BED_TYPES, type BedSpec, bedLabel } from "./beds"

interface BedsEditorProps {
  value: BedSpec[]
  onChange: (beds: BedSpec[]) => void
}

/**
 * Chips like `[1 King ▾] [2 Single ▾] +`.
 *
 * Adding a bed type that is already listed bumps its count instead of
 * creating a second row: "2 Single" and "1 Single, 1 Single" mean the same
 * thing to a guest, and only one of them survives a round-trip cleanly.
 */
export function BedsEditor({ value, onChange }: BedsEditorProps) {
  const used = new Set(value.map((bed) => bed.type))
  const available = BED_TYPES.filter((bed) => !used.has(bed.value))

  const setCount = (type: BedType, count: number) => {
    if (count < 1) {
      onChange(value.filter((bed) => bed.type !== type))
      return
    }
    onChange(value.map((bed) => (bed.type === type ? { ...bed, count } : bed)))
  }

  const addBed = (rawType: string) => {
    const type = rawType as BedType
    if (used.has(type)) {
      setCount(type, (value.find((bed) => bed.type === type)?.count ?? 0) + 1)
      return
    }
    onChange([...value, { type, count: 1 }])
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {value.map((bed) => (
        <div
          key={bed.type}
          className="flex items-center gap-1 rounded-full border bg-muted/40 py-1 pl-1 pr-2"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-full"
            aria-label={`One fewer ${bedLabel(bed.type)}`}
            onClick={() => setCount(bed.type, bed.count - 1)}
          >
            <Minus className="h-3 w-3" />
          </Button>
          <span className="min-w-4 text-center text-sm tabular-nums">
            {bed.count}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 rounded-full"
            aria-label={`One more ${bedLabel(bed.type)}`}
            onClick={() => setCount(bed.type, bed.count + 1)}
          >
            <Plus className="h-3 w-3" />
          </Button>
          <span className="text-sm">{bedLabel(bed.type)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-5 w-5 rounded-full"
            aria-label={`Remove ${bedLabel(bed.type)}`}
            onClick={() => setCount(bed.type, 0)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}

      {available.length > 0 && (
        <Select value="" onValueChange={addBed}>
          <SelectTrigger className="h-8 w-[130px]" aria-label="Add a bed">
            <SelectValue placeholder="+ Add bed" />
          </SelectTrigger>
          <SelectContent>
            {available.map((bed) => (
              <SelectItem key={bed.value} value={bed.value}>
                {bed.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
