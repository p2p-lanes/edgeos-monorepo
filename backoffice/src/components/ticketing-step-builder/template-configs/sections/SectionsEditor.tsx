import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { AlertTriangle, Plus } from "lucide-react"
import { useEffect, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { SectionEditor } from "./SectionEditor"
import { SectionRailRow } from "./SectionRailRow"
import type {
  AttendeeCategoryOption,
  ProductSection,
  SectionProduct,
  VisibilityFormFieldOption,
} from "./sectionTypes"
import { toKey } from "./sectionTypes"

interface SectionsEditorProps {
  sections: ProductSection[]
  onChange: (sections: ProductSection[]) => void
  products: SectionProduct[]
  /** The step's product category. Products are resolved into the checkout by
   *  this category, so sections render empty without it. */
  productCategory?: string | null
  assignLabel?: string
  showMediaFields?: boolean
  showAttendeeCategories?: boolean
  attendeeCategories?: AttendeeCategoryOption[]
  visibilityFormFields?: VisibilityFormFieldOption[]
}

function sectionSummary(
  section: ProductSection,
  showAttendeeCategories: boolean,
  attendeeCategories: AttendeeCategoryOption[],
): string {
  const matchedCategoryLabels =
    showAttendeeCategories && Array.isArray(section.attendee_categories)
      ? attendeeCategories
          .filter((c) => section.attendee_categories?.includes(c.id))
          .map((c) => c.label)
      : []

  const hints: string[] = []
  if (matchedCategoryLabels.length > 0) {
    hints.push(matchedCategoryLabels.join(", "))
  } else if (section.visible_if?.field_id) {
    hints.push("conditional")
  }

  return [`${section.product_ids.length} products`, ...hints].join(" · ")
}

export function SectionsEditor({
  sections,
  onChange,
  products,
  productCategory,
  assignLabel = "Assign product",
  showMediaFields = true,
  showAttendeeCategories = false,
  attendeeCategories = [],
  visibilityFormFields = [],
}: SectionsEditorProps) {
  const ordered = [...sections].sort((a, b) => a.order - b.order)

  const [selectedKey, setSelectedKey] = useState<string | null>(
    ordered[0]?.key ?? null,
  )

  // Keep selection valid as sections change (deletes, external updates).
  useEffect(() => {
    if (sections.length === 0) {
      if (selectedKey !== null) setSelectedKey(null)
      return
    }
    if (!sections.some((s) => s.key === selectedKey)) {
      const first = [...sections].sort((a, b) => a.order - b.order)[0]
      setSelectedKey(first?.key ?? null)
    }
  }, [sections, selectedKey])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const handleUpdate = (key: string, updates: Partial<ProductSection>) => {
    onChange(sections.map((s) => (s.key === key ? { ...s, ...updates } : s)))
  }

  const handleDelete = (key: string) => {
    onChange(sections.filter((s) => s.key !== key))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = ordered.findIndex((s) => s.key === active.id)
    const newIndex = ordered.findIndex((s) => s.key === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(ordered, oldIndex, newIndex).map((s, i) => ({
      ...s,
      order: i,
    }))
    onChange(reordered)
  }

  const handleAdd = () => {
    const n = sections.length
    const newLabel = `Section ${n + 1}`
    const newSection: ProductSection = {
      key: `${toKey(newLabel)}-${Date.now()}`,
      label: newLabel,
      order: n,
      product_ids: [],
      ...(showMediaFields ? { description: "", image_url: "" } : {}),
    }
    onChange([...sections, newSection])
    setSelectedKey(newSection.key)
  }

  const selectedSection = ordered.find((s) => s.key === selectedKey) ?? null

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label className="text-sm font-medium">Sections</Label>
        <p className="text-xs text-muted-foreground">
          Configure how products are grouped in the checkout
        </p>
      </div>

      {sections.length > 0 && !productCategory && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            This step has no product category, so its products will not appear
            in the checkout. Set a Product Category under Display & advanced.
          </AlertDescription>
        </Alert>
      )}

      {sections.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No sections yet. Products display as a flat list.
          </p>
          <Button variant="outline" size="sm" onClick={handleAdd}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add section
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <div className="flex flex-col gap-2 md:w-52 md:shrink-0">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={ordered.map((s) => s.key)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-2">
                  {ordered.map((section) => (
                    <SectionRailRow
                      key={section.key}
                      section={section}
                      selected={section.key === selectedKey}
                      showThumbnail={showMediaFields}
                      summary={sectionSummary(
                        section,
                        showAttendeeCategories,
                        attendeeCategories,
                      )}
                      onSelect={setSelectedKey}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-start text-xs text-muted-foreground"
              onClick={handleAdd}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add section
            </Button>
          </div>

          <div className="min-w-0 flex-1 rounded-lg border bg-background p-4 shadow-sm">
            {selectedSection ? (
              <SectionEditor
                key={selectedSection.key}
                section={selectedSection}
                onUpdate={handleUpdate}
                products={products}
                assignLabel={assignLabel}
                showMediaFields={showMediaFields}
                showAttendeeCategories={showAttendeeCategories}
                attendeeCategories={attendeeCategories}
                visibilityFormFields={visibilityFormFields}
              />
            ) : (
              <div className="text-center text-sm text-muted-foreground">
                Select a section to edit.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
