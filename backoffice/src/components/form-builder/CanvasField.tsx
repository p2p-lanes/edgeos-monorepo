import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, Trash2 } from "lucide-react"
import type { FormFieldPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { FIELD_TYPES, FULL_WIDTH_TYPES } from "./constants"

interface CanvasFieldProps {
  field: FormFieldPublic
  sectionKey: string
  isSelected: boolean
  onSelect: (fieldId: string) => void
  onDelete: (fieldId: string) => void
}

function FieldPreview({ field }: { field: FormFieldPublic }) {
  const type = field.field_type

  if (type === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <div className="h-4 w-4 rounded border border-input bg-background" />
        <span className="text-sm text-muted-foreground">
          {field.placeholder || "Yes / No"}
        </span>
      </div>
    )
  }

  if (type === "select" || type === "multiselect") {
    return (
      <div className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 text-sm text-muted-foreground">
        {field.placeholder || `Select${type === "multiselect" ? " multiple" : ""}...`}
        <svg
          className="ml-auto h-4 w-4 opacity-50"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    )
  }

  if (type === "textarea") {
    return (
      <div className="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground">
        {field.placeholder || "Enter text..."}
      </div>
    )
  }

  return (
    <div className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 text-sm text-muted-foreground">
      {type === "date" ? (
        <span className="opacity-50">mm/dd/yyyy</span>
      ) : (
        field.placeholder || `Enter ${type}...`
      )}
    </div>
  )
}

export function CanvasField({
  field,
  sectionKey,
  isSelected,
  onSelect,
  onDelete,
}: CanvasFieldProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: field.id,
    data: {
      type: "canvas-field",
      field,
      sectionKey,
    },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const isFullWidth = FULL_WIDTH_TYPES.has(field.field_type)

  const handleClick = () => {
    onSelect(field.id)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      onSelect(field.id)
    }
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    onDelete(field.id)
  }

  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`${isFullWidth ? "md:col-span-2" : ""}`}
      >
        <div className="rounded-md border-2 border-dashed border-primary/30 bg-primary/5 min-h-[72px]" />
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${isFullWidth ? "md:col-span-2" : ""}`}
    >
      <div
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-label={`Configure ${field.label} field`}
        className={`group relative flex items-stretch rounded-md transition-all cursor-pointer ${
          isSelected
            ? "bg-primary/5 ring-1 ring-primary/30"
            : "hover:bg-muted/50"
        }`}
      >
        {/* Left drag handle — always visible */}
        <div
          className="flex items-center justify-center w-6 shrink-0 rounded-l-md cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground transition-colors touch-none"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4" />
        </div>

        {/* Field content */}
        <div className="flex-1 py-2 pr-2">
          {/* Delete button — shows on group hover */}
          <div className="flex items-start justify-between mb-1.5">
            <div className="space-y-1">
              <label className="text-sm font-semibold text-foreground">
                {field.label}
                {field.required && (
                  <span className="text-destructive ml-0.5">*</span>
                )}
              </label>
              {field.help_text && (
                <p className="text-xs text-muted-foreground leading-snug">
                  {field.help_text}
                </p>
              )}
            </div>
            <button
              type="button"
              className="ml-2 mt-0.5 h-6 w-6 shrink-0 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={handleDelete}
              aria-label={`Delete ${field.label}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Input preview */}
          <FieldPreview field={field} />
        </div>
      </div>
    </div>
  )
}

export function CanvasFieldOverlay({ field }: { field: FormFieldPublic }) {
  const fieldTypeDef = FIELD_TYPES.find((t) => t.value === field.field_type)
  const TypeIcon = fieldTypeDef?.icon

  return (
    <div className="rounded-lg border bg-background p-3 shadow-xl w-72">
      <div className="flex items-center gap-2 mb-2">
        <GripVertical className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold truncate">
          {field.label}
          {field.required && (
            <span className="text-destructive ml-0.5">*</span>
          )}
        </span>
        {TypeIcon && (
          <Badge variant="outline" className="shrink-0 text-xs gap-1 py-0 ml-auto">
            <TypeIcon className="h-3 w-3" />
            {fieldTypeDef?.label}
          </Badge>
        )}
      </div>
      <FieldPreview field={field} />
    </div>
  )
}
