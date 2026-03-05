import { useDraggable } from "@dnd-kit/core"
import { GripVertical } from "lucide-react"
import type { FieldTypeDefinition } from "./constants"
import { FIELD_TYPES, PALETTE_ITEM_PREFIX } from "./constants"

function PaletteItem({ fieldType }: { fieldType: FieldTypeDefinition }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${PALETTE_ITEM_PREFIX}${fieldType.value}`,
    data: {
      type: "palette-item",
      fieldType: fieldType.value,
    },
  })

  const Icon = fieldType.icon

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-3 rounded-lg border bg-background p-3 cursor-grab active:cursor-grabbing select-none transition-colors hover:bg-accent hover:border-accent-foreground/20 ${isDragging ? "opacity-40" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`Drag ${fieldType.label} field`}
    >
      <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="text-sm font-medium truncate">{fieldType.label}</span>
    </div>
  )
}

export function FieldPalette() {
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <h2 className="text-sm font-semibold">Field Types</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Drag a field onto the canvas
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {FIELD_TYPES.map((fieldType) => (
          <PaletteItem key={fieldType.value} fieldType={fieldType} />
        ))}
      </div>
    </div>
  )
}
