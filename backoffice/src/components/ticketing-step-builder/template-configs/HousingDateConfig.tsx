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
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import {
  type ProductSection,
  parseConfigSections,
  SortableSectionCard,
  toKey,
} from "./SortableSectionCard"
import type { TemplateConfigProps } from "./types"

const HOUSING_VARIANTS = [
  {
    value: "default",
    label: "Default",
    description: "Grouped card per property",
  },
  {
    value: "compact",
    label: "Compact",
    description: "Minimal rows with thumbnails",
  },
  {
    value: "grid",
    label: "Grid",
    description: "2-column image gallery",
  },
  {
    value: "showcase",
    label: "Showcase",
    description: "Large hero image per property",
  },
] as const

function DefaultPreview() {
  return (
    <div className="flex flex-col w-full rounded border border-muted-foreground/10 overflow-hidden">
      <div className="h-5 bg-muted-foreground/10 relative">
        <div className="absolute inset-x-0 bottom-0 h-3 bg-gradient-to-t from-muted-foreground/20 to-transparent" />
        <div className="absolute bottom-0.5 left-1 h-0.5 w-6 rounded-full bg-muted-foreground/40" />
      </div>
      <div className="p-1 flex flex-col gap-0.5">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="flex items-center gap-1 rounded-sm bg-muted-foreground/5 p-0.5"
          >
            <div className="w-1.5 h-1.5 rounded-full border border-muted-foreground/20 shrink-0" />
            <div className="h-0.5 flex-1 rounded-full bg-muted-foreground/15" />
            <div className="h-0.5 w-3 rounded-full bg-muted-foreground/20 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}

function CompactPreview() {
  return (
    <div className="flex flex-col gap-1 w-full">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex items-center gap-1 rounded bg-muted-foreground/5 p-0.5"
        >
          <div className="w-1 h-1 rounded-full bg-muted-foreground/20 shrink-0" />
          <div className="w-3 h-3 rounded-sm bg-muted-foreground/10 shrink-0" />
          <div className="flex-1 flex flex-col gap-0.5">
            <div className="h-0.5 w-6 rounded-full bg-muted-foreground/20" />
            <div className="h-0.5 w-4 rounded-full bg-muted-foreground/10" />
          </div>
          <div className="h-1 w-3 rounded-full bg-muted-foreground/20 shrink-0" />
        </div>
      ))}
    </div>
  )
}

function GridPreview() {
  return (
    <div className="grid grid-cols-2 gap-1 w-full">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="flex flex-col rounded overflow-hidden border border-muted-foreground/10"
        >
          <div className="h-5 bg-muted-foreground/10" />
          <div className="p-0.5 flex flex-col gap-0.5">
            <div className="h-0.5 w-6 rounded-full bg-muted-foreground/20" />
            <div className="h-0.5 w-4 rounded-full bg-muted-foreground/10" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ShowcasePreview() {
  return (
    <div className="flex flex-col w-full rounded border border-muted-foreground/10 overflow-hidden">
      <div className="h-7 bg-muted-foreground/10 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-muted-foreground/5 to-muted-foreground/15" />
        <div className="absolute bottom-1 left-1 flex items-center gap-0.5">
          <div className="w-0.5 h-2 rounded-full bg-muted-foreground/40" />
          <div className="h-0.5 w-5 rounded-full bg-muted-foreground/40" />
        </div>
      </div>
      <div className="p-1 flex flex-col gap-0.5">
        <div className="flex items-center gap-1 rounded-sm bg-muted-foreground/5 p-0.5">
          <div className="w-3 h-3 rounded bg-muted-foreground/10 shrink-0" />
          <div className="flex-1 flex flex-col gap-0.5">
            <div className="h-0.5 w-5 rounded-full bg-muted-foreground/20" />
            <div className="h-0.5 w-3 rounded-full bg-muted-foreground/10" />
          </div>
          <div className="w-1.5 h-1.5 rounded-full border border-muted-foreground/20 shrink-0" />
        </div>
      </div>
    </div>
  )
}

const PREVIEW_MAP: Record<string, React.FC> = {
  default: DefaultPreview,
  compact: CompactPreview,
  grid: GridPreview,
  showcase: ShowcasePreview,
}

export function HousingDateConfig({
  config,
  onChange,
  popupId,
  productCategory,
}: TemplateConfigProps) {
  const variant = (config?.variant as string) || "default"
  const showDates =
    config?.show_dates !== false && config?.price_per_day !== false
  const parsed = parseConfigSections(config)

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
    const newLabel = `Property ${parsed.sections.length + 1}`
    const newSection: ProductSection = {
      key: `${toKey(newLabel)}-${Date.now()}`,
      label: newLabel,
      order: parsed.sections.length,
      product_ids: [],
      description: "",
      image_url: "",
    }
    updateSections([...parsed.sections, newSection])
  }

  const updateHousingDateMode = (enabled: boolean) => {
    onChange({
      ...config,
      show_dates: enabled,
      price_per_day: enabled,
    })
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Design Variant */}
      <div className="flex flex-col gap-3">
        <div>
          <Label className="text-sm font-medium">Design Variant</Label>
          <p className="text-xs text-muted-foreground">
            Choose how housing options are displayed in the checkout
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {HOUSING_VARIANTS.map((v) => {
            const isActive = variant === v.value
            const Preview = PREVIEW_MAP[v.value]
            return (
              <button
                key={v.value}
                type="button"
                onClick={() =>
                  onChange({
                    ...config,
                    ...parsed,
                    variant: v.value === "default" ? undefined : v.value,
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

      {/* Date picker visibility */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Show date picker</Label>
          <p className="text-xs text-muted-foreground">
            This is tied to Price per night. If customers can choose dates, the
            housing product is sold per night. If not, it behaves like a flat
            price ticket with no stay selection.
          </p>
        </div>
        <Switch checked={showDates} onCheckedChange={updateHousingDateMode} />
      </div>

      <Separator />

      {/* Pricing Mode — only meaningful when dates are shown */}
      <div
        className={cn(
          "flex items-center justify-between",
          !showDates && "opacity-50",
        )}
      >
        <div>
          <Label className="text-sm font-medium">Price per night</Label>
          <p className="text-xs text-muted-foreground">
            This setting is tied to Show date picker. Disabling it also removes
            date selection, since customers can no longer choose multiple
            nights.
          </p>
        </div>
        <Switch checked={showDates} onCheckedChange={updateHousingDateMode} />
      </div>

      <Separator />

      {/* Property Sections */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Property Sections</Label>
          <p className="text-xs text-muted-foreground">
            Group housing products by property or hotel
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleAddSection}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Property
        </Button>
      </div>

      {parsed.sections.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No sections configured. Housing products will be displayed as a flat
          list.
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
                    assignLabel="Assign room"
                  />
                ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
