import { useDroppable } from "@dnd-kit/core"
import {
  verticalListSortingStrategy,
  SortableContext,
} from "@dnd-kit/sortable"
import { Check, Pencil, Trash2, X } from "lucide-react"
import { useRef, useState } from "react"
import type { FormFieldPublic, FormSectionPublic, FormSectionUpdate } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { CanvasField } from "./CanvasField"

interface SectionDropZoneProps {
  sectionKey: string
  section: FormSectionPublic | null
  fields: FormFieldPublic[]
  selectedFieldId: string | null
  isLast: boolean
  onSelectField: (fieldId: string) => void
  onDeleteField: (fieldId: string) => void
  onUpdateSection: (sectionId: string, updates: FormSectionUpdate) => void
  onDeleteSection: (sectionId: string) => void
}

export function SectionDropZone({
  sectionKey,
  section,
  fields,
  selectedFieldId,
  isLast,
  onSelectField,
  onDeleteField,
  onUpdateSection,
  onDeleteSection,
}: SectionDropZoneProps) {
  const [isEditingLabel, setIsEditingLabel] = useState(false)
  const [editLabelValue, setEditLabelValue] = useState("")
  const [isEditingDescription, setIsEditingDescription] = useState(false)
  const [editDescriptionValue, setEditDescriptionValue] = useState("")
  const labelInputRef = useRef<HTMLInputElement>(null)
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null)

  const sectionLabel = section?.label ?? "Unsectioned"
  const sectionDescription = section?.description ?? null
  const isApiSection = section !== null

  const { setNodeRef, isOver } = useDroppable({
    id: `section-${sectionKey}`,
    data: {
      type: "section",
      sectionKey,
    },
  })

  // --- Label editing ---

  const handleStartEditLabel = () => {
    if (!isApiSection) return
    setEditLabelValue(sectionLabel)
    setIsEditingLabel(true)
    setTimeout(() => labelInputRef.current?.focus(), 0)
  }

  const handleConfirmEditLabel = () => {
    const trimmed = editLabelValue.trim()
    if (trimmed && trimmed !== sectionLabel && section) {
      onUpdateSection(section.id, { label: trimmed })
    }
    setIsEditingLabel(false)
  }

  const handleCancelEditLabel = () => {
    setEditLabelValue(sectionLabel)
    setIsEditingLabel(false)
  }

  const handleLabelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleConfirmEditLabel()
    if (e.key === "Escape") handleCancelEditLabel()
  }

  // --- Description editing ---

  const handleStartEditDescription = () => {
    if (!isApiSection) return
    setEditDescriptionValue(sectionDescription ?? "")
    setIsEditingDescription(true)
    setTimeout(() => descriptionInputRef.current?.focus(), 0)
  }

  const handleConfirmEditDescription = () => {
    if (!section) return
    const trimmed = editDescriptionValue.trim()
    const newDesc = trimmed || null
    if (newDesc !== (sectionDescription ?? null)) {
      onUpdateSection(section.id, { description: newDesc })
    }
    setIsEditingDescription(false)
  }

  const handleCancelEditDescription = () => {
    setEditDescriptionValue(sectionDescription ?? "")
    setIsEditingDescription(false)
  }

  const handleDescriptionKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") handleCancelEditDescription()
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleConfirmEditDescription()
    }
  }

  return (
    <div ref={setNodeRef}>
      <div
        className={`grid gap-8 lg:grid-cols-[220px,1fr] pb-10 transition-all duration-150 rounded-lg ${
          isOver
            ? "bg-primary/5 ring-2 ring-primary/40 ring-offset-2 ring-offset-background"
            : ""
        }`}
      >
        {/* Left: section header */}
        <div className="space-y-1 group/section">
          {isEditingLabel ? (
            <div className="space-y-1.5">
              <Input
                ref={labelInputRef}
                value={editLabelValue}
                onChange={(e) => setEditLabelValue(e.target.value)}
                onKeyDown={handleLabelKeyDown}
                onBlur={handleConfirmEditLabel}
                className="h-8 text-lg font-semibold"
              />
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleConfirmEditLabel}
                  aria-label="Confirm section name"
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleCancelEditLabel}
                  aria-label="Cancel editing"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-1">
                <h2 className="text-xl font-semibold tracking-tight flex-1">
                  {sectionLabel}
                </h2>
                {isApiSection && (
                  <div className="flex gap-0.5 opacity-0 group-hover/section:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      onClick={handleStartEditLabel}
                      aria-label={`Rename section ${sectionLabel}`}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    {fields.length === 0 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => onDeleteSection(section!.id)}
                        aria-label={`Delete section ${sectionLabel}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Description */}
              {isApiSection && (
                isEditingDescription ? (
                  <div className="space-y-1.5">
                    <Textarea
                      ref={descriptionInputRef}
                      value={editDescriptionValue}
                      onChange={(e) => setEditDescriptionValue(e.target.value)}
                      onKeyDown={handleDescriptionKeyDown}
                      onBlur={handleConfirmEditDescription}
                      placeholder="Add a description..."
                      rows={2}
                      className="text-sm"
                    />
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={handleConfirmEditDescription}
                        aria-label="Confirm description"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={handleCancelEditDescription}
                        aria-label="Cancel editing description"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p
                    className="text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                    onClick={handleStartEditDescription}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") handleStartEditDescription()
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label="Edit section description"
                  >
                    {sectionDescription || "Click to add description..."}
                  </p>
                )
              )}

              {!isApiSection && (
                <p className="text-sm text-muted-foreground">
                  {fields.length === 0
                    ? "Drop fields here to get started."
                    : `${fields.length} field${fields.length !== 1 ? "s" : ""}`}
                </p>
              )}
            </>
          )}
        </div>

        {/* Right: fields grid */}
        <SortableContext
          items={fields.map((f) => f.id)}
          strategy={verticalListSortingStrategy}
        >
          <div
            className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5 min-h-[48px]"
          >
            {fields.length === 0 && (
              <div
                className={`md:col-span-2 flex items-center justify-center py-8 text-sm rounded-lg transition-all duration-150 ${
                  isOver
                    ? "border-2 border-primary/50 bg-primary/5 text-primary"
                    : "border border-dashed border-muted-foreground/30 text-muted-foreground"
                }`}
              >
                {isOver ? "Drop here" : "Drag and drop fields here"}
              </div>
            )}
            {fields.map((field) => (
              <CanvasField
                key={field.id}
                field={field}
                sectionKey={sectionKey}
                isSelected={selectedFieldId === field.id}
                onSelect={onSelectField}
                onDelete={onDeleteField}
              />
            ))}
          </div>
        </SortableContext>
      </div>

      {!isLast && <Separator className="mb-10" />}
    </div>
  )
}
