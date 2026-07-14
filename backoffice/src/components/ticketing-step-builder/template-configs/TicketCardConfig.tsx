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

/** Design variants for ticket-card. The portal also supports `tabs`,
 *  `compact`, and `showcase`; the default is `stacked`. */
const TICKET_CARD_VARIANTS = [
  {
    value: "stacked",
    label: "Stacked",
    description: "Full cards with image, description, and product rows",
  },
  {
    value: "tabs",
    label: "Tabs",
    description: "Anchor strip + stacked sections",
  },
  {
    value: "compact",
    label: "Compact",
    description: "Image-less list view for many sections",
  },
  {
    value: "showcase",
    label: "Showcase",
    description: "Horizontal card, image beside details",
  },
] as const

const TICKET_CARD_SURFACES = [
  {
    value: "theme",
    label: "Theme",
    description: "Inherit popup theme colours",
  },
  {
    value: "light",
    label: "Light",
    description: "Pinned cream surface",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Pinned dark surface",
  },
] as const

const ASPECTS = [
  { value: "16:9", label: "Banner", hint: "16:9" },
  { value: "3:2", label: "Classic", hint: "3:2" },
  { value: "1:1", label: "Square", hint: "1:1" },
  { value: "4:5", label: "Portrait", hint: "4:5" },
] as const

export function TicketCardConfig({
  config,
  onChange,
  popupId,
  productCategory,
}: TemplateConfigProps) {
  const parsed = parseConfigSections(config)
  const variant = (config?.variant as string) || "stacked"
  const surface = (config?.surface as string) || "theme"
  const imageAspect = (config?.image_aspect as string) || "16:9"

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

  const productsResults = Array.isArray(productsData?.results)
    ? productsData.results
    : []
  const products = productsResults.map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    slug: p.slug,
    is_active: p.is_active,
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
            How section cards are arranged in the checkout
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TICKET_CARD_VARIANTS.map((v) => {
            const isActive = variant === v.value
            return (
              <button
                key={v.value}
                type="button"
                onClick={() =>
                  onChange({
                    ...config,
                    variant: v.value === "stacked" ? undefined : v.value,
                  })
                }
                className={cn(
                  "relative rounded-lg border-2 p-3 text-left transition-all hover:bg-accent/50",
                  isActive ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                {isActive && (
                  <Check className="absolute top-1.5 right-1.5 h-3.5 w-3.5 text-primary" />
                )}
                <p
                  className={cn(
                    "text-xs font-semibold",
                    isActive && "text-primary",
                  )}
                >
                  {v.label}
                </p>
                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                  {v.description}
                </p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Surface */}
      <div className="flex flex-col gap-3">
        <div>
          <Label className="text-sm font-medium">Card surface</Label>
          <p className="text-xs text-muted-foreground">
            Override the card background for this step only. Theme inherits from
            the popup; light/dark pin a fixed surface.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {TICKET_CARD_SURFACES.map((s) => {
            const isActive = surface === s.value
            return (
              <button
                key={s.value}
                type="button"
                onClick={() =>
                  onChange({
                    ...config,
                    surface: s.value === "theme" ? undefined : s.value,
                  })
                }
                className={cn(
                  "relative rounded-lg border-2 p-3 text-left transition-all hover:bg-accent/50",
                  isActive ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                {isActive && (
                  <Check className="absolute top-1.5 right-1.5 h-3.5 w-3.5 text-primary" />
                )}
                <p
                  className={cn(
                    "text-xs font-semibold",
                    isActive && "text-primary",
                  )}
                >
                  {s.label}
                </p>
                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                  {s.description}
                </p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Image aspect */}
      <div className="flex flex-col gap-2">
        <Label className="text-sm font-medium">
          Section image aspect ratio
        </Label>
        <p className="text-xs text-muted-foreground">
          Applied to every section's hero image. Banner keeps cards short;
          Square and Portrait give the image more presence.
        </p>
        <div className="flex flex-wrap gap-2">
          {ASPECTS.map((a) => {
            const isActive = imageAspect === a.value
            return (
              <button
                key={a.value}
                type="button"
                onClick={() =>
                  onChange({
                    ...config,
                    image_aspect: a.value === "16:9" ? undefined : a.value,
                  })
                }
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-md border-2 px-3 py-1.5 text-xs font-medium transition-all",
                  isActive
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:bg-accent/50",
                )}
              >
                <span>{a.label}</span>
                <span className="text-[10px] text-muted-foreground">
                  {a.hint}
                </span>
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
            Each section renders as one card with its hero image, label,
            optional description, and the assigned product rows.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleAddSection}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Section
        </Button>
      </div>

      {parsed.sections.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No sections configured. Add at least one to display products.
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
                    showMediaFields={true}
                  />
                ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
