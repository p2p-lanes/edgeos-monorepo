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
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useQuery } from "@tanstack/react-query"
import { Check, GripVertical, Package, Plus, Trash2, X } from "lucide-react"
import { useState } from "react"

import { ProductsService } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import type { TemplateConfigProps } from "./types"

const TICKET_SELECT_VARIANTS = [
  {
    value: "stacked",
    label: "Stacked",
    description: "Full cards stacked vertically",
  },
  {
    value: "tabs",
    label: "Tabs",
    description: "Tabbed navigation by attendee",
  },
  {
    value: "compact",
    label: "Compact",
    description: "Condensed minimal rows",
  },
  {
    value: "accordion",
    label: "Accordion",
    description: "Collapsible sections per attendee",
  },
] as const

function StackedPreview() {
  return (
    <div className="flex flex-col gap-1 w-full">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="rounded border border-muted-foreground/10 p-1 flex flex-col gap-0.5"
        >
          <div className="h-1 w-6 rounded-full bg-muted-foreground/25" />
          <div className="h-0.5 w-8 rounded-full bg-muted-foreground/10" />
          <div className="h-0.5 w-5 rounded-full bg-muted-foreground/10" />
        </div>
      ))}
    </div>
  )
}

function TabsPreview() {
  return (
    <div className="flex flex-col w-full">
      <div className="flex gap-0.5 mb-1">
        <div className="flex-1 h-1.5 rounded-t-sm bg-muted-foreground/25" />
        <div className="flex-1 h-1.5 rounded-t-sm bg-muted-foreground/10" />
        <div className="flex-1 h-1.5 rounded-t-sm bg-muted-foreground/10" />
      </div>
      <div className="rounded-b border border-muted-foreground/10 p-1 flex flex-col gap-0.5">
        <div className="h-0.5 w-8 rounded-full bg-muted-foreground/15" />
        <div className="h-0.5 w-6 rounded-full bg-muted-foreground/10" />
      </div>
    </div>
  )
}

function CompactPreview() {
  return (
    <div className="flex flex-col gap-0.5 w-full">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex items-center gap-1 rounded-sm bg-muted-foreground/5 px-1 py-0.5"
        >
          <div className="w-2 h-2 rounded-full bg-muted-foreground/15 shrink-0" />
          <div className="flex-1 h-0.5 rounded-full bg-muted-foreground/15" />
          <div className="w-3 h-0.5 rounded-full bg-muted-foreground/20 shrink-0" />
        </div>
      ))}
    </div>
  )
}

function AccordionPreview() {
  return (
    <div className="flex flex-col gap-0.5 w-full">
      <div className="rounded border border-muted-foreground/10 p-1 flex flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-muted-foreground/20 shrink-0" />
          <div className="h-0.5 w-6 rounded-full bg-muted-foreground/25 flex-1" />
          <div className="h-1 w-1 border-b border-r border-muted-foreground/30 rotate-45 shrink-0 -mt-0.5" />
        </div>
        <div className="h-0.5 w-8 rounded-full bg-muted-foreground/10 ml-3" />
        <div className="h-0.5 w-6 rounded-full bg-muted-foreground/10 ml-3" />
      </div>
      <div className="rounded border border-muted-foreground/10 p-1 flex items-center gap-1">
        <div className="w-2 h-2 rounded-full bg-muted-foreground/10 shrink-0" />
        <div className="h-0.5 w-6 rounded-full bg-muted-foreground/15 flex-1" />
        <div className="h-1 w-1 border-b border-r border-muted-foreground/20 -rotate-45 shrink-0 mt-0.5" />
      </div>
    </div>
  )
}

const VARIANT_PREVIEW_MAP: Record<string, React.FC> = {
  stacked: StackedPreview,
  tabs: TabsPreview,
  compact: CompactPreview,
  accordion: AccordionPreview,
}

export interface TicketSelectSection {
  key: string
  label: string
  order: number
  product_ids: string[]
}

interface TicketSelectConfig {
  sections: TicketSelectSection[]
}

function parseConfig(
  config: Record<string, unknown> | null,
): TicketSelectConfig {
  if (!config || !Array.isArray(config.sections)) {
    return { sections: [] }
  }
  return config as unknown as TicketSelectConfig
}

function toKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

// --- Sortable section card ---

interface SortableSectionCardProps {
  section: TicketSelectSection
  onUpdate: (key: string, updates: Partial<TicketSelectSection>) => void
  onDelete: (key: string) => void
  products: Array<{ id: string; name: string }>
}

function SortableSectionCard({
  section,
  onUpdate,
  onDelete,
  products,
}: SortableSectionCardProps) {
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

  // Products assigned to this section
  const assignedProducts = section.product_ids
    .map((id) => products.find((p) => p.id === id))
    .filter(Boolean) as Array<{ id: string; name: string }>

  // Products available for assignment (not yet in this section)
  const availableProducts = products.filter(
    (p) => !section.product_ids.includes(p.id),
  )

  const [showProductPicker, setShowProductPicker] = useState(false)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-lg border bg-background shadow-sm"
    >
      <div className="flex items-center gap-3 px-3 py-3">
        <button
          type="button"
          className="cursor-grab text-muted-foreground hover:text-foreground shrink-0"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="flex-1 min-w-0">
          <Input
            value={section.label}
            onChange={(e) => onUpdate(section.key, { label: e.target.value })}
            className="h-7 text-sm font-medium"
            placeholder="Section label"
          />
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(section.key)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Assigned products */}
      {assignedProducts.length > 0 && (
        <>
          <Separator />
          <div className="px-3 py-2">
            <div className="flex flex-col gap-1">
              {assignedProducts.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 text-xs text-muted-foreground py-0.5"
                >
                  <Package className="h-3 w-3 shrink-0" />
                  <span className="truncate">{p.name}</span>
                  <button
                    type="button"
                    className="ml-auto shrink-0 hover:text-destructive"
                    onClick={() =>
                      onUpdate(section.key, {
                        product_ids: section.product_ids.filter(
                          (id) => id !== p.id,
                        ),
                      })
                    }
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Add product */}
      {availableProducts.length > 0 && (
        <div className="px-3 pb-2">
          {showProductPicker ? (
            <div className="flex flex-col gap-1 rounded border p-2 bg-muted/30">
              {availableProducts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="flex items-center gap-2 text-xs text-left py-1 px-1 rounded hover:bg-accent"
                  onClick={() => {
                    onUpdate(section.key, {
                      product_ids: [...section.product_ids, p.id],
                    })
                    setShowProductPicker(false)
                  }}
                >
                  <Package className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs mt-1"
                onClick={() => setShowProductPicker(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs w-full"
              onClick={() => setShowProductPicker(true)}
            >
              <Plus className="h-3 w-3 mr-1" />
              Assign product
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

// --- Main component ---

export function TicketSelectConfig({
  config,
  onChange,
  popupId,
  productCategory,
}: TemplateConfigProps) {
  const parsed = parseConfig(config)
  const variant = (config?.variant as string) || "stacked"

  const { data: productsData } = useQuery({
    queryKey: ["products", popupId, productCategory],
    queryFn: () =>
      ProductsService.listProducts({
        popupId,
        limit: 200,
        ...(productCategory ? { category: productCategory } : {}),
      }),
    enabled: !!popupId,
  })

  const products = (productsData?.results ?? []).map((p) => ({
    id: p.id,
    name: p.name,
  }))

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const updateSections = (sections: TicketSelectSection[]) => {
    onChange({ ...config, sections })
  }

  const handleSectionUpdate = (
    key: string,
    updates: Partial<TicketSelectSection>,
  ) => {
    updateSections(
      parsed.sections.map((s) => (s.key === key ? { ...s, ...updates } : s)),
    )
  }

  const handleSectionDelete = (key: string) => {
    updateSections(parsed.sections.filter((s) => s.key !== key))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = parsed.sections.findIndex((s) => s.key === active.id)
    const newIndex = parsed.sections.findIndex((s) => s.key === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(parsed.sections, oldIndex, newIndex).map(
      (s, i) => ({ ...s, order: i }),
    )
    updateSections(reordered)
  }

  const handleAddSection = () => {
    const newLabel = `Section ${parsed.sections.length + 1}`
    const newSection: TicketSelectSection = {
      key: `${toKey(newLabel)}-${Date.now()}`,
      label: newLabel,
      order: parsed.sections.length,
      product_ids: [],
    }
    updateSections([...parsed.sections, newSection])
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Design Variant */}
      <div className="flex flex-col gap-3">
        <div>
          <Label className="text-sm font-medium">Design Variant</Label>
          <p className="text-xs text-muted-foreground">
            Choose how ticket passes are displayed in the checkout
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TICKET_SELECT_VARIANTS.map((v) => {
            const isActive = variant === v.value
            const Preview = VARIANT_PREVIEW_MAP[v.value]
            return (
              <button
                key={v.value}
                type="button"
                onClick={() =>
                  onChange({
                    ...config,
                    ...parsed,
                    variant: v.value === "stacked" ? undefined : v.value,
                  })
                }
                className={cn(
                  "relative flex flex-col items-center gap-2 rounded-lg border-2 p-3 text-center transition-all hover:bg-accent/50",
                  isActive ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                {isActive && (
                  <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-primary-foreground" />
                  </div>
                )}
                <div className="w-full px-1">
                  <Preview />
                </div>
                <div>
                  <p
                    className={cn(
                      "text-xs font-medium",
                      isActive && "text-primary",
                    )}
                  >
                    {v.label}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    {v.description}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <Separator />

      {/* Sections */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Sections</Label>
          <p className="text-xs text-muted-foreground">
            Configure how products are grouped in the checkout
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleAddSection}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Section
        </Button>
      </div>

      {parsed.sections.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No sections configured. Products will be displayed as a flat list.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={parsed.sections.map((s) => s.key)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-2">
              {parsed.sections
                .sort((a, b) => a.order - b.order)
                .map((section) => (
                  <SortableSectionCard
                    key={section.key}
                    section={section}
                    onUpdate={handleSectionUpdate}
                    onDelete={handleSectionDelete}
                    products={products}
                  />
                ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
