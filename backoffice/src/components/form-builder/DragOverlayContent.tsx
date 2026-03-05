import { GripVertical, LayoutTemplate } from "lucide-react"
import type { FormFieldPublic, FormSectionPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { CanvasFieldOverlay } from "./CanvasField"
import {
  FIELD_TYPES,
  PALETTE_ITEM_PREFIX,
  parseSortableSectionId,
  SORTABLE_SECTION_PREFIX,
} from "./constants"

interface DragOverlayContentProps {
  activeId: string | null
  fields: FormFieldPublic[]
  sections?: FormSectionPublic[]
}

export function DragOverlayContent({
  activeId,
  fields,
  sections = [],
}: DragOverlayContentProps) {
  if (!activeId) return null

  if (
    typeof activeId === "string" &&
    activeId.startsWith(SORTABLE_SECTION_PREFIX)
  ) {
    const sectionId = parseSortableSectionId(activeId)
    const section = sectionId ? sections.find((s) => s.id === sectionId) : null
    if (section) {
      return (
        <div className="flex items-center gap-3 rounded-lg border-2 border-primary bg-background p-3 shadow-xl w-56">
          <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
          <LayoutTemplate className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{section.label}</span>
        </div>
      )
    }
    return null
  }

  if (
    typeof activeId === "string" &&
    activeId.startsWith(PALETTE_ITEM_PREFIX)
  ) {
    const typeValue = activeId.replace(PALETTE_ITEM_PREFIX, "")
    const fieldType = FIELD_TYPES.find((t) => t.value === typeValue)
    if (!fieldType) return null

    const Icon = fieldType.icon

    return (
      <div className="flex items-center gap-3 rounded-lg border-2 border-primary bg-background p-3 shadow-xl w-56">
        <GripVertical className="h-4 w-4 text-muted-foreground" />
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{fieldType.label}</span>
        <Badge variant="secondary" className="ml-auto text-xs">
          New
        </Badge>
      </div>
    )
  }

  const field = fields.find((f) => f.id === activeId)
  if (field) {
    return <CanvasFieldOverlay field={field} />
  }

  return null
}
