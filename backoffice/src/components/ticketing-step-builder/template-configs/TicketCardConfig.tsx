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
import { useQuery } from "@tanstack/react-query"
import { Check, Plus } from "lucide-react"

import { ProductsService } from "@/client"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import {
  type ProductSection,
  parseConfigSections,
  SortableSectionCard,
  toKey,
} from "./SortableSectionCard"
import type { TemplateConfigProps } from "./types"

/** Design variants for ticket-card. Deliberately excludes Accordion/Collapsible:
 * the template renders sections directly without attendee-category grouping,
 * which removes the legacy "Main" pill the Collapsible variant produces. */
const TICKET_CARD_VARIANTS = [
  {
    value: "stacked",
    label: "Stacked",
    description: "Full cards with image, description, and product rows",
  },
  {
    value: "tabs",
    label: "Tabs",
    description: "Section labels as a tab strip",
  },
  {
    value: "compact",
    label: "Compact",
    description: "Dense rows without images",
  },
] as const

function StackedPreview() {
  return (
    <div className="flex flex-col gap-1 w-full">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="rounded border border-muted-foreground/10 overflow-hidden flex flex-col"
        >
          <div className="h-3 bg-muted-foreground/15" />
          <div className="p-1 flex flex-col gap-0.5">
            <div className="h-0.5 w-6 rounded-full bg-muted-foreground/25" />
            <div className="h-0.5 w-8 rounded-full bg-muted-foreground/10" />
          </div>
        </div>
      ))}
    </div>
  )
}

function TabsPreview() {
  return (
    <div className="flex flex-col w-full gap-0.5">
      <div className="flex gap-0.5">
        <div className="flex-1 h-1.5 rounded-full bg-muted-foreground/25" />
        <div className="flex-1 h-1.5 rounded-full bg-muted-foreground/10" />
        <div className="flex-1 h-1.5 rounded-full bg-muted-foreground/10" />
      </div>
      <div className="rounded border border-muted-foreground/10 overflow-hidden">
        <div className="h-2 bg-muted-foreground/15" />
        <div className="p-1 flex flex-col gap-0.5">
          <div className="h-0.5 w-6 rounded-full bg-muted-foreground/25" />
        </div>
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

const VARIANT_PREVIEW_MAP: Record<string, React.FC> = {
  stacked: StackedPreview,
  tabs: TabsPreview,
  compact: CompactPreview,
}

export function TicketCardConfig({
  config,
  onChange,
  popupId,
  productCategory,
}: TemplateConfigProps) {
  const parsed = parseConfigSections(config)
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

  const updateSections = (sections: ProductSection[]) => {
    onChange({ ...config, sections })
  }

  const handleSectionUpdate = (
    key: string,
    updates: Partial<ProductSection>,
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
    const newSection: ProductSection = {
      key: `${toKey(newLabel)}-${Date.now()}`,
      label: newLabel,
      order: parsed.sections.length,
      product_ids: [],
      image_aspect: "16:9",
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
            Layout for the ticket sections
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {TICKET_CARD_VARIANTS.map((v) => {
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
            Each section gets a hero image (16:9 or 3:2), a description with
            an automatic "Read more" expander, and a list of products.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleAddSection}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Section
        </Button>
      </div>

      {parsed.sections.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No sections yet. Add one to start grouping products.
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
                    showMediaFields
                    showImageAspect
                  />
                ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
