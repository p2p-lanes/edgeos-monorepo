import {
  verticalListSortingStrategy,
  SortableContext,
} from "@dnd-kit/sortable"
import { FolderPlus, LayoutTemplate } from "lucide-react"
import { useRef, useState } from "react"
import type { FormFieldPublic, FormSectionPublic, FormSectionUpdate } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getSortableSectionId } from "./constants"
import { SectionDropZone } from "./SectionDropZone"
import { SortableSectionWrapper } from "./SortableSectionWrapper"

const UNSECTIONED = "__unsectioned__"

interface FormCanvasProps {
  fieldsBySection: Record<string, FormFieldPublic[]>
  sections: FormSectionPublic[]
  orderedSectionKeys: string[]
  selectedFieldId: string | null
  onSelectField: (fieldId: string) => void
  onDeleteField: (fieldId: string) => void
  onUpdateSection: (sectionId: string, updates: FormSectionUpdate) => void
  onDeleteSection: (sectionId: string) => void
  onAddSection: (label: string) => void
}

export function FormCanvas({
  fieldsBySection,
  sections,
  orderedSectionKeys,
  selectedFieldId,
  onSelectField,
  onDeleteField,
  onUpdateSection,
  onDeleteSection,
  onAddSection,
}: FormCanvasProps) {
  const [isAddingSection, setIsAddingSection] = useState(false)
  const [newSectionName, setNewSectionName] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const totalFields = Object.values(fieldsBySection).reduce(
    (acc, arr) => acc + arr.length,
    0,
  )

  const sectionSortableItems = orderedSectionKeys
    .filter((k) => k !== UNSECTIONED)
    .map((k) => getSortableSectionId(k))
  const sectionMap = new Map(sections.map((s) => [s.id, s]))

  const renderSection = (key: string, _idx: number, isLast: boolean) => {
    const section = sectionMap.get(key) ?? null
    const dropZone = (
      <SectionDropZone
        key={key}
        sectionKey={key}
        section={section}
        fields={fieldsBySection[key] || []}
        selectedFieldId={selectedFieldId}
        isLast={isLast}
        onSelectField={onSelectField}
        onDeleteField={onDeleteField}
        onUpdateSection={onUpdateSection}
        onDeleteSection={onDeleteSection}
      />
    )
    if (key === UNSECTIONED) return dropZone
    return (
      <SortableSectionWrapper key={key} sectionId={key}>
        {dropZone}
      </SortableSectionWrapper>
    )
  }

  const handleAddSection = () => {
    setIsAddingSection(true)
    setNewSectionName("")
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleConfirmAddSection = () => {
    const trimmed = newSectionName.trim()
    if (trimmed && !sections.some((s) => s.label === trimmed)) {
      onAddSection(trimmed)
    }
    setIsAddingSection(false)
    setNewSectionName("")
  }

  const handleCancelAddSection = () => {
    setIsAddingSection(false)
    setNewSectionName("")
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleConfirmAddSection()
    if (e.key === "Escape") handleCancelAddSection()
  }

  if (totalFields === 0 && orderedSectionKeys.length <= 1 && !isAddingSection) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <LayoutTemplate className="h-16 w-16 text-muted-foreground/40 mb-4" />
        <h3 className="text-lg font-semibold text-muted-foreground mb-2">
          Start building your form
        </h3>
        <p className="text-sm text-muted-foreground max-w-md mb-6">
          Drag field types from the right panel and drop them here to build
          your application form.
        </p>
        <div className="w-full max-w-2xl">
          <SortableContext
            items={sectionSortableItems}
            strategy={verticalListSortingStrategy}
          >
            {orderedSectionKeys.map((key, idx) =>
              renderSection(key, idx, idx === orderedSectionKeys.length - 1),
            )}
          </SortableContext>
        </div>
        <Button
          variant="outline"
          className="w-full max-w-2xl border-dashed mt-4"
          onClick={handleAddSection}
        >
          <FolderPlus className="mr-2 h-4 w-4" />
          Add Section
        </Button>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 py-8 md:px-12">
      <SortableContext
        items={sectionSortableItems}
        strategy={verticalListSortingStrategy}
      >
        {orderedSectionKeys.map((key, idx) =>
          renderSection(
            key,
            idx,
            idx === orderedSectionKeys.length - 1 && !isAddingSection,
          ),
        )}
      </SortableContext>

      {isAddingSection ? (
        <div className="flex items-center gap-2 p-4 rounded-lg border border-dashed border-primary bg-primary/5 mt-4">
          <Input
            ref={inputRef}
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleConfirmAddSection}
            placeholder="Section name..."
            className="h-8 text-sm"
          />
          <Button size="sm" onClick={handleConfirmAddSection}>
            Add
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCancelAddSection}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          className="w-full border-dashed mt-4"
          onClick={handleAddSection}
        >
          <FolderPlus className="mr-2 h-4 w-4" />
          Add Section
        </Button>
      )}
    </div>
  )
}
