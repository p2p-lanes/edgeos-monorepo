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
import {
  AlertTriangle,
  CalendarRange,
  GripVertical,
  Package,
  Plus,
  Trash2,
  Utensils,
  X,
} from "lucide-react"
import { useMemo, useState } from "react"

import { ProductsService } from "@/client"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { toKey } from "./sections/sectionTypes"
import type { TemplateConfigProps } from "./types"

// ---------------------------------------------------------------------------
// Types — mirror backend MealPlanSection / MealPlanSectionProduct /
// MealPlanMenuOption.
// ---------------------------------------------------------------------------

interface MealPlanMenuOption {
  key: string
  icon?: string
  title: string
  description?: string
  tags: string[]
}

interface MealPlanSectionProduct {
  product_id: string
  coverage_start: string
  coverage_end: string
  menu_options: MealPlanMenuOption[]
}

interface MealPlanSection {
  key: string
  label: string
  order: number
  description?: string
  products: MealPlanSectionProduct[]
}

interface MealPlanConfig {
  sections: MealPlanSection[]
}

const MEAL_PLAN_CATEGORY = "meal_plan"

// ---------------------------------------------------------------------------
// Parsing — coerce the JSONB blob coming from the server into our shape.
// Be defensive: validator may have accepted unknown fields, missing arrays.
// ---------------------------------------------------------------------------

function parseConfig(config: Record<string, unknown> | null): MealPlanConfig {
  const raw = (config ?? {}) as Record<string, unknown>
  const sectionsRaw = Array.isArray(raw.sections) ? raw.sections : []

  const sections: MealPlanSection[] = sectionsRaw.map((s, i) => {
    const sec = (s ?? {}) as Record<string, unknown>
    const productsRaw = Array.isArray(sec.products) ? sec.products : []
    return {
      key: typeof sec.key === "string" ? sec.key : `section-${i}`,
      label: typeof sec.label === "string" ? sec.label : `Section ${i + 1}`,
      order: typeof sec.order === "number" ? sec.order : i,
      description:
        typeof sec.description === "string" ? sec.description : undefined,
      products: productsRaw.map((p) => {
        const prod = (p ?? {}) as Record<string, unknown>
        const optsRaw = Array.isArray(prod.menu_options)
          ? prod.menu_options
          : []
        return {
          product_id:
            typeof prod.product_id === "string" ? prod.product_id : "",
          coverage_start:
            typeof prod.coverage_start === "string" ? prod.coverage_start : "",
          coverage_end:
            typeof prod.coverage_end === "string" ? prod.coverage_end : "",
          menu_options: optsRaw.map((o) => {
            const opt = (o ?? {}) as Record<string, unknown>
            return {
              key: typeof opt.key === "string" ? opt.key : "",
              icon: typeof opt.icon === "string" ? opt.icon : undefined,
              title: typeof opt.title === "string" ? opt.title : "",
              description:
                typeof opt.description === "string"
                  ? opt.description
                  : undefined,
              tags: Array.isArray(opt.tags)
                ? (opt.tags as unknown[]).filter(
                    (t): t is string => typeof t === "string",
                  )
                : [],
            }
          }),
        }
      }),
    }
  })

  return { sections }
}

interface PickerProduct {
  id: string
  name: string
  price: string
  slug: string
  is_active: boolean
  category: string
}

// ---------------------------------------------------------------------------
// Menu option row — repeating sub-form per product
// ---------------------------------------------------------------------------

function SortableMenuOptionRow({
  sortableId,
  option,
  duplicateKey,
  onUpdate,
  onDelete,
}: {
  sortableId: string
  option: MealPlanMenuOption
  duplicateKey: boolean
  onUpdate: (updates: Partial<MealPlanMenuOption>) => void
  onDelete: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const [keyDirty, setKeyDirty] = useState(option.key.length > 0)

  const handleTitleChange = (title: string) => {
    if (keyDirty) {
      onUpdate({ title })
      return
    }
    // Key auto-fills from title until the user overrides it.
    onUpdate({ title, key: toKey(title) })
  }

  const tagsText = option.tags.join(", ")
  const handleTagsChange = (text: string) => {
    const tags = text
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
    onUpdate({ tags })
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex flex-col gap-2 rounded-md border bg-background p-2 shadow-sm",
        duplicateKey && "border-destructive",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="cursor-grab text-muted-foreground hover:text-foreground shrink-0 mt-2"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>

        <Input
          value={option.icon ?? ""}
          onChange={(e) => onUpdate({ icon: e.target.value.slice(0, 4) })}
          placeholder="🥬"
          className="h-8 w-12 text-center text-base shrink-0"
          aria-label="Menu option icon"
        />

        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <Input
            value={option.title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Fresh Spring Rolls"
            className="h-8 text-sm"
            aria-label="Menu option title"
          />
          <div className="grid grid-cols-2 gap-1.5">
            <Input
              value={option.key}
              onChange={(e) => {
                setKeyDirty(true)
                onUpdate({ key: e.target.value })
              }}
              placeholder="w1-spring-rolls"
              className="h-7 text-xs font-mono"
              aria-label="Menu option key"
            />
            <Input
              value={tagsText}
              onChange={(e) => handleTagsChange(e.target.value)}
              placeholder="GF, Vegan"
              className="h-7 text-xs"
              aria-label="Menu option tags (comma separated)"
            />
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          aria-label="Delete menu option"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Textarea
        value={option.description ?? ""}
        onChange={(e) => onUpdate({ description: e.target.value })}
        placeholder="Short description (optional)"
        className="text-xs min-h-12 ml-7"
      />

      {duplicateKey && (
        <p className="text-xs text-destructive flex items-center gap-1 ml-7">
          <AlertTriangle className="h-3 w-3" />
          Duplicate key in this product — each menu option must have a unique
          key.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Product card — one row inside a section
// ---------------------------------------------------------------------------

function MealPlanProductCard({
  product,
  pickerProduct,
  onUpdate,
  onRemove,
}: {
  product: MealPlanSectionProduct
  pickerProduct: PickerProduct | undefined
  onUpdate: (updates: Partial<MealPlanSectionProduct>) => void
  onRemove: () => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>()
    for (const o of product.menu_options) {
      counts.set(o.key, (counts.get(o.key) ?? 0) + 1)
    }
    return new Set(
      [...counts.entries()].filter(([, c]) => c > 1).map(([k]) => k),
    )
  }, [product.menu_options])

  const datesInvalid =
    product.coverage_start &&
    product.coverage_end &&
    product.coverage_start > product.coverage_end

  const reservedKeys = product.menu_options.some((o) => o.key === "chef")

  const handleOptionUpdate = (
    index: number,
    updates: Partial<MealPlanMenuOption>,
  ) => {
    const next = product.menu_options.map((o, i) =>
      i === index ? { ...o, ...updates } : o,
    )
    onUpdate({ menu_options: next })
  }

  const handleOptionDelete = (index: number) => {
    onUpdate({
      menu_options: product.menu_options.filter((_, i) => i !== index),
    })
  }

  const handleOptionAdd = () => {
    const next: MealPlanMenuOption = {
      key: `option-${Date.now()}`,
      icon: "",
      title: "",
      description: "",
      tags: [],
    }
    onUpdate({ menu_options: [...product.menu_options, next] })
  }

  // Use a stable list of ids for SortableContext. Falls back to a synthetic
  // id when key is empty so the dnd context doesn't choke.
  const optionIds = product.menu_options.map(
    (o, i) => o.key || `__empty_${i}__`,
  )

  const handleOptionDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = optionIds.indexOf(String(active.id))
    const newIndex = optionIds.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    onUpdate({
      menu_options: arrayMove(product.menu_options, oldIndex, newIndex),
    })
  }

  return (
    <div className="rounded-md border bg-muted/20 p-3 flex flex-col gap-3">
      {/* Product header */}
      <div className="flex items-start gap-2">
        <Package className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
        <div className="flex-1 min-w-0">
          {pickerProduct ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium truncate">
                {pickerProduct.name}
              </span>
              {pickerProduct.is_active === false && (
                <span className="rounded border px-1 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
                  Inactive
                </span>
              )}
              <span className="ml-auto font-mono tabular-nums text-xs text-muted-foreground">
                ${pickerProduct.price}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span className="truncate">
                Product not found ({product.product_id.slice(0, 8) || "unset"})
              </span>
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label="Remove product"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Coverage dates */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <CalendarRange className="h-3 w-3" />
            Coverage start
          </Label>
          <DatePicker
            value={product.coverage_start}
            onChange={(v) => onUpdate({ coverage_start: v })}
            placeholder="Pick a start date"
            className="h-9"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <CalendarRange className="h-3 w-3" />
            Coverage end
          </Label>
          <DatePicker
            value={product.coverage_end}
            onChange={(v) => onUpdate({ coverage_end: v })}
            placeholder="Pick an end date"
            className="h-9"
          />
        </div>
      </div>

      {datesInvalid && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          Coverage start must be on or before coverage end.
        </p>
      )}
      {reservedKeys && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          The key <code className="font-mono">chef</code> is reserved — rename
          any menu option that uses it.
        </p>
      )}

      {/* Menu options */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium text-muted-foreground">
            Menu options ({product.menu_options.length})
          </Label>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={handleOptionAdd}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add option
          </Button>
        </div>

        {product.menu_options.length === 0 ? (
          <div className="rounded border border-dashed p-3 text-center text-xs text-muted-foreground">
            No menu options yet. Add at least one — buyers will pick from these
            per day.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleOptionDragEnd}
          >
            <SortableContext
              items={optionIds}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-2">
                {product.menu_options.map((option, i) => (
                  <SortableMenuOptionRow
                    key={optionIds[i]}
                    sortableId={optionIds[i]}
                    option={option}
                    duplicateKey={
                      option.key.length > 0 && duplicateKeys.has(option.key)
                    }
                    onUpdate={(updates) => handleOptionUpdate(i, updates)}
                    onDelete={() => handleOptionDelete(i)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section card — wraps products
// ---------------------------------------------------------------------------

function SortableSectionCard({
  section,
  availableProducts,
  productsById,
  onUpdate,
  onDelete,
}: {
  section: MealPlanSection
  availableProducts: PickerProduct[]
  productsById: Map<string, PickerProduct>
  onUpdate: (updates: Partial<MealPlanSection>) => void
  onDelete: () => void
}) {
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

  const [showProductPicker, setShowProductPicker] = useState(false)

  const usedProductIds = new Set(section.products.map((p) => p.product_id))
  const pickableProducts = availableProducts.filter(
    (p) => !usedProductIds.has(p.id),
  )

  const handleProductAdd = (productId: string) => {
    const next: MealPlanSectionProduct = {
      product_id: productId,
      coverage_start: "",
      coverage_end: "",
      menu_options: [],
    }
    onUpdate({ products: [...section.products, next] })
    setShowProductPicker(false)
  }

  const handleProductUpdate = (
    index: number,
    updates: Partial<MealPlanSectionProduct>,
  ) => {
    const next = section.products.map((p, i) =>
      i === index ? { ...p, ...updates } : p,
    )
    onUpdate({ products: next })
  }

  const handleProductRemove = (index: number) => {
    onUpdate({ products: section.products.filter((_, i) => i !== index) })
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-lg border bg-background shadow-sm"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-3">
        <button
          type="button"
          className="cursor-grab text-muted-foreground hover:text-foreground shrink-0"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder section"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="flex-1 min-w-0">
          <Input
            value={section.label}
            onChange={(e) => onUpdate({ label: e.target.value })}
            className="h-7 text-sm font-medium"
            placeholder="Section label"
            aria-label="Section label"
          />
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          aria-label="Delete section"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="px-3 pb-3 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-medium text-muted-foreground">
            Description (HTML supported)
          </Label>
          <Textarea
            value={section.description ?? ""}
            onChange={(e) => onUpdate({ description: e.target.value })}
            placeholder="<p>Orders must be placed by <strong>Friday of the previous week</strong>.</p>"
            className="min-h-16 text-sm font-mono"
          />
          <p className="text-[10px] text-muted-foreground">
            Sanitized HTML — use tags like &lt;p&gt;, &lt;strong&gt;,
            &lt;em&gt;, &lt;ul&gt;.
          </p>
        </div>

        <Separator />

        {/* Products */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground">
              Products ({section.products.length})
            </Label>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowProductPicker((v) => !v)}
              disabled={pickableProducts.length === 0 && !showProductPicker}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add product
            </Button>
          </div>

          {showProductPicker && pickableProducts.length > 0 && (
            <div className="flex flex-col gap-1 rounded border p-2 bg-muted/30">
              {pickableProducts.map((p) => {
                const inactive = p.is_active === false
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={cn(
                      "flex items-center gap-2 text-xs text-left py-1 px-1 rounded hover:bg-accent",
                      inactive && "opacity-50",
                    )}
                    onClick={() => handleProductAdd(p.id)}
                  >
                    <Package className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0 flex flex-col">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate">{p.name}</span>
                        {inactive && (
                          <span className="shrink-0 rounded border px-1 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
                            Inactive
                          </span>
                        )}
                      </div>
                      {p.slug && (
                        <span className="truncate font-mono text-[10px] text-muted-foreground/70">
                          {p.slug}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                      ${p.price}
                    </span>
                  </button>
                )
              })}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs mt-1"
                onClick={() => setShowProductPicker(false)}
              >
                Cancel
              </Button>
            </div>
          )}

          {section.products.length === 0 ? (
            <div className="rounded border border-dashed p-3 text-center text-xs text-muted-foreground">
              No products assigned to this section. Add a meal-plan product to
              configure its menu.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {section.products.map((product, i) => (
                <MealPlanProductCard
                  key={`${product.product_id}-${i}`}
                  product={product}
                  pickerProduct={productsById.get(product.product_id)}
                  onUpdate={(updates) => handleProductUpdate(i, updates)}
                  onRemove={() => handleProductRemove(i)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MealPlanSelectConfig({
  config,
  onChange,
  popupId,
}: TemplateConfigProps) {
  const parsed = parseConfig(config)

  // Always query meal_plan products — the step is hard-wired to this category
  // and the operator-set product_category is informational at best for this
  // template (see backend/spec). The backend store has free-form category
  // strings, so this is just a UX filter.
  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ["products", popupId, MEAL_PLAN_CATEGORY],
    queryFn: () =>
      ProductsService.listProducts({
        popupId,
        limit: 200,
        category: MEAL_PLAN_CATEGORY,
      }),
    enabled: !!popupId,
  })

  const productList: PickerProduct[] = useMemo(() => {
    const results = Array.isArray(productsData?.results)
      ? productsData.results
      : []
    return results.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      slug: p.slug,
      is_active: p.is_active ?? true,
      category: p.category ?? "",
    }))
  }, [productsData])

  const productsById = useMemo(() => {
    const map = new Map<string, PickerProduct>()
    for (const p of productList) {
      map.set(p.id, p)
    }
    return map
  }, [productList])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const updateConfig = (updates: Partial<MealPlanConfig>) => {
    onChange({
      ...config,
      sections: updates.sections ?? parsed.sections,
    })
  }

  const handleSectionUpdate = (
    key: string,
    updates: Partial<MealPlanSection>,
  ) => {
    updateConfig({
      sections: parsed.sections.map((s) =>
        s.key === key ? { ...s, ...updates } : s,
      ),
    })
  }

  const handleSectionDelete = (key: string) => {
    updateConfig({
      sections: parsed.sections.filter((s) => s.key !== key),
    })
  }

  const handleSectionAdd = () => {
    const label = `Section ${parsed.sections.length + 1}`
    const newSection: MealPlanSection = {
      key: `${toKey(label)}-${Date.now()}`,
      label,
      order: parsed.sections.length,
      description: "",
      products: [],
    }
    updateConfig({ sections: [...parsed.sections, newSection] })
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
    updateConfig({ sections: reordered })
  }

  const noMealPlanProducts = !productsLoading && productList.length === 0

  return (
    <div className="flex flex-col gap-5">
      {noMealPlanProducts && (
        <div className="rounded-lg border border-dashed border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 p-3 flex items-start gap-2">
          <Utensils className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900 dark:text-amber-100">
            <p className="font-medium">No meal-plan products yet</p>
            <p className="mt-0.5">
              Create meal-plan products first in Products &rarr; New Product
              (category: <code className="font-mono">meal_plan</code>), then
              come back to wire them into sections here.
            </p>
          </div>
        </div>
      )}

      {/* Sections */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Sections</Label>
          <p className="text-xs text-muted-foreground">
            Group meal-plan products by week or theme. Each product carries its
            own coverage range and dish menu.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleSectionAdd}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Section
        </Button>
      </div>

      {parsed.sections.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No sections configured yet. Add a section to start grouping meal-plan
          products.
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
              {[...parsed.sections]
                .sort((a, b) => a.order - b.order)
                .map((section) => (
                  <SortableSectionCard
                    key={section.key}
                    section={section}
                    availableProducts={productList}
                    productsById={productsById}
                    onUpdate={(updates) =>
                      handleSectionUpdate(section.key, updates)
                    }
                    onDelete={() => handleSectionDelete(section.key)}
                  />
                ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
