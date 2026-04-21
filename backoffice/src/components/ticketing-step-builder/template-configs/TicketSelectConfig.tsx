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
import { Check, Layers, Plus } from "lucide-react"

import {
  ProductsService,
  type TierGroupPublic,
  type TierPhasePublic,
} from "@/client"
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

// Products from listProducts may carry tier enrichment when the popup flag is on.
// We treat the response as potentially having these fields (additive, BC-2).
interface EnrichedProduct {
  id: string
  name: string
  tier_group?: TierGroupPublic | null
  phase?: TierPhasePublic | null
}

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

export type TicketSelectSection = ProductSection

export function TicketSelectConfig({
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

  // Cast to enriched shape — fields are optional and null for non-grouped products (BC-2)
  const enrichedProducts = (productsData?.results ??
    []) as unknown as EnrichedProduct[]

  const products = enrichedProducts.map((p) => ({
    id: p.id,
    // Include phase label in display name when grouped
    name: p.phase?.label ? `${p.phase.label} — ${p.name}` : p.name,
  }))

  // Build tier group buckets for the visual panel
  const hasAnyTierGroup = enrichedProducts.some((p) => !!p.tier_group)

  type GroupBucket = {
    group: TierGroupPublic
    products: Array<EnrichedProduct & { phase: TierPhasePublic }>
  }

  const groupBuckets: GroupBucket[] = []
  const ungroupedProducts: EnrichedProduct[] = []

  if (hasAnyTierGroup) {
    const groupMap = new Map<string, GroupBucket>()
    for (const product of enrichedProducts) {
      if (product.tier_group && product.phase) {
        const g = product.tier_group
        if (!groupMap.has(g.id)) {
          groupMap.set(g.id, { group: g, products: [] })
        }
        groupMap
          .get(g.id)!
          .products.push(
            product as EnrichedProduct & { phase: TierPhasePublic },
          )
      } else {
        ungroupedProducts.push(product)
      }
    }
    // Sort phases within each group by order asc
    for (const bucket of groupMap.values()) {
      bucket.products.sort((a, b) => a.phase.order - b.phase.order)
      groupBuckets.push(bucket)
    }
  }

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

      {/* Tier Group Overview — shown when popup has tier progression enabled */}
      {hasAnyTierGroup && (
        <>
          <div className="flex flex-col gap-3">
            <div>
              <Label className="text-sm font-medium">Tier Groups</Label>
              <p className="text-xs text-muted-foreground">
                Products organised by tier group. Phase order is ascending
                within each group.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              {groupBuckets.map(({ group, products: phaseProducts }) => (
                <div
                  key={group.id}
                  className="rounded-md border bg-muted/30 p-3 space-y-1.5"
                >
                  <div className="flex items-center gap-2">
                    <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium">{group.name}</span>
                    {group.shared_stock_cap != null && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {group.shared_stock_remaining ?? 0}/
                        {group.shared_stock_cap} remaining
                      </span>
                    )}
                  </div>
                  <div className="ml-5.5 flex flex-col gap-0.5">
                    {phaseProducts.map((p) => (
                      <div
                        key={p.id}
                        className="text-xs text-muted-foreground flex items-center gap-1.5"
                      >
                        <span className="font-medium text-foreground">
                          {p.phase.label}
                        </span>
                        <span>—</span>
                        <span className="truncate">{p.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {ungroupedProducts.length > 0 && (
                <div className="rounded-md border border-dashed p-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium text-muted-foreground">
                      Ungrouped
                    </span>
                  </div>
                  <div className="ml-5.5 flex flex-col gap-0.5">
                    {ungroupedProducts.map((p) => (
                      <div
                        key={p.id}
                        className="text-xs text-muted-foreground truncate"
                      >
                        {p.name}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <Separator />
        </>
      )}

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
                    showMediaFields={false}
                  />
                ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
