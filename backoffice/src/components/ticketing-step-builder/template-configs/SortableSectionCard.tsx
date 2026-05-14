import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, Package, Plus, Trash2, X } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ImageUpload } from "@/components/ui/image-upload"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

export interface ProductSection {
  key: string
  label: string
  order: number
  product_ids: string[]
  description?: string
  image_url?: string
  attendee_categories?: string[] | null
}

export function parseConfigSections(config: Record<string, unknown> | null): {
  sections: ProductSection[]
} {
  if (!config || !Array.isArray(config.sections)) {
    return { sections: [] }
  }
  return config as unknown as { sections: ProductSection[] }
}

export function toKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

interface AttendeeCategoryOption {
  id: string
  key: string
  label: string
}

export interface SectionProduct {
  id: string
  name: string
  price?: string
  slug?: string
  is_active?: boolean
}

interface SortableSectionCardProps {
  section: ProductSection
  onUpdate: (key: string, updates: Partial<ProductSection>) => void
  onDelete: (key: string) => void
  products: SectionProduct[]
  assignLabel?: string
  showMediaFields?: boolean
  showAttendeeCategories?: boolean
  attendeeCategories?: AttendeeCategoryOption[]
}

export function SortableSectionCard({
  section,
  onUpdate,
  onDelete,
  products,
  assignLabel = "Assign product",
  showMediaFields = true,
  showAttendeeCategories = false,
  attendeeCategories = [],
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

  const assignedProducts = section.product_ids
    .map((id) => products.find((p) => p.id === id))
    .filter(Boolean) as SectionProduct[]

  const availableProducts = products.filter(
    (p) => !section.product_ids.includes(p.id),
  )

  const [showProductPicker, setShowProductPicker] = useState(false)

  const handleCategoryToggle = (catId: string, checked: boolean) => {
    const current = section.attendee_categories ?? []
    const next = checked
      ? [...current, catId]
      : current.filter((c) => c !== catId)
    // Collapse rule: empty OR all categories checked → null (visible to all)
    const resolved =
      next.length === 0 || next.length === attendeeCategories.length
        ? null
        : next
    onUpdate(section.key, { attendee_categories: resolved })
  }

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

      {showMediaFields && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${section.key}-image`}
              className="text-xs font-medium text-muted-foreground"
            >
              Image
            </label>
            <ImageUpload
              value={section.image_url || null}
              onChange={(url) =>
                onUpdate(section.key, { image_url: url ?? "" })
              }
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${section.key}-description`}
              className="text-xs font-medium text-muted-foreground"
            >
              Description
            </label>
            <Textarea
              id={`${section.key}-description`}
              value={section.description ?? ""}
              onChange={(e) =>
                onUpdate(section.key, { description: e.target.value })
              }
              placeholder="Short description shown on the property card"
              className="min-h-[60px] text-sm"
            />
          </div>
        </div>
      )}

      {showAttendeeCategories && (
        <div className="px-3 pb-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Visible to
            </Label>
            <div className="flex items-center gap-4">
              {attendeeCategories.map(({ id, label }) => (
                <div key={id} className="flex items-center gap-1.5">
                  <Checkbox
                    id={`${section.key}-cat-${id}`}
                    checked={(section.attendee_categories ?? []).includes(id)}
                    onCheckedChange={(checked) =>
                      handleCategoryToggle(id, checked === true)
                    }
                  />
                  <label
                    htmlFor={`${section.key}-cat-${id}`}
                    className="text-xs cursor-pointer"
                  >
                    {label}
                  </label>
                </div>
              ))}
            </div>
            {section.attendee_categories == null && (
              <span className="text-xs text-muted-foreground">
                Visible to all attendees
              </span>
            )}
          </div>
        </div>
      )}

      {assignedProducts.length > 0 && (
        <>
          <Separator />
          <div className="px-3 py-2">
            <div className="flex flex-col gap-1">
              {assignedProducts.map((p) => {
                const inactive = p.is_active === false
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "flex items-center gap-2 text-xs text-muted-foreground py-0.5",
                      inactive && "opacity-50",
                    )}
                  >
                    <Package className="h-3 w-3 shrink-0" />
                    <span className="truncate">{p.name}</span>
                    {inactive && (
                      <span className="shrink-0 rounded border px-1 py-px text-[10px] uppercase tracking-wide">
                        Inactive
                      </span>
                    )}
                    {p.price != null && (
                      <span className="ml-auto shrink-0 font-mono tabular-nums">
                        ${p.price}
                      </span>
                    )}
                    <button
                      type="button"
                      className={cn(
                        "shrink-0 hover:text-destructive",
                        p.price == null && "ml-auto",
                      )}
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
                )
              })}
            </div>
          </div>
        </>
      )}

      {availableProducts.length > 0 && (
        <div className="px-3 pb-2">
          {showProductPicker ? (
            <div className="flex flex-col gap-1 rounded border p-2 bg-muted/30">
              {availableProducts.map((p) => {
                const inactive = p.is_active === false
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={cn(
                      "flex items-center gap-2 text-xs text-left py-1 px-1 rounded hover:bg-accent",
                      inactive && "opacity-50",
                    )}
                    onClick={() => {
                      onUpdate(section.key, {
                        product_ids: [...section.product_ids, p.id],
                      })
                      setShowProductPicker(false)
                    }}
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
                    {p.price != null && (
                      <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                        ${p.price}
                      </span>
                    )}
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
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs w-full"
              onClick={() => setShowProductPicker(true)}
            >
              <Plus className="h-3 w-3 mr-1" />
              {assignLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
