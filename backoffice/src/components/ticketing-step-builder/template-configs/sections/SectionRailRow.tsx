import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, ImageIcon, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ProductSection } from "./sectionTypes"

interface SectionRailRowProps {
  section: ProductSection
  selected: boolean
  summary: string
  onSelect: (key: string) => void
  onDelete: (key: string) => void
}

export function SectionRailRow({
  section,
  selected,
  summary,
  onSelect,
  onDelete,
}: SectionRailRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.key })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-2 rounded-lg border bg-background px-2 py-2 shadow-sm",
        selected
          ? "border-primary bg-accent"
          : "hover:border-muted-foreground/30",
      )}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab text-muted-foreground hover:text-foreground"
        aria-label="Reorder section"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={() => onSelect(section.key)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
          {section.image_url ? (
            <img
              src={section.image_url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {section.label || "Untitled section"}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {summary}
          </div>
        </div>
      </button>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
        aria-label="Delete section"
        onClick={() => onDelete(section.key)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
