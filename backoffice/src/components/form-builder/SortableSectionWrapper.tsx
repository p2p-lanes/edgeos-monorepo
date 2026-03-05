import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical } from "lucide-react"
import { getSortableSectionId } from "./constants"

interface SortableSectionWrapperProps {
  sectionId: string
  children: React.ReactNode
}

export function SortableSectionWrapper({
  sectionId,
  children,
}: SortableSectionWrapperProps) {
  const id = getSortableSectionId(sectionId)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    data: {
      type: "section-sortable",
      sectionId,
      sectionKey: sectionId,
    },
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  }

  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="min-h-[120px] rounded-lg border-2 border-dashed border-primary/30 bg-primary/5"
      />
    )
  }

  return (
    <div ref={setNodeRef} style={style} className="flex gap-2 items-stretch">
      <button
        type="button"
        className="flex items-center justify-center w-8 shrink-0 rounded-l-md cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors touch-none border-0 bg-transparent p-0"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder section"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}
