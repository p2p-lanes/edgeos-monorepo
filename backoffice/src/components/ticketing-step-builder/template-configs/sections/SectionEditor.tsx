import { ChevronDown, Package, Plus, Search, X } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ImageUpload } from "@/components/ui/image-upload"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type {
  AttendeeCategoryOption,
  ProductSection,
  SectionProduct,
  VisibilityFormFieldOption,
} from "./sectionTypes"

interface SectionEditorProps {
  section: ProductSection
  onUpdate: (key: string, updates: Partial<ProductSection>) => void
  products: SectionProduct[]
  assignLabel?: string
  showMediaFields?: boolean
  showAttendeeCategories?: boolean
  attendeeCategories?: AttendeeCategoryOption[]
  /** When provided and non-empty, renders the "Visibility condition" picker
   *  so admins can gate the section against a form answer. */
  visibilityFormFields?: VisibilityFormFieldOption[]
}

export function SectionEditor({
  section,
  onUpdate,
  products,
  assignLabel = "Assign product",
  showMediaFields = true,
  showAttendeeCategories = false,
  attendeeCategories = [],
  visibilityFormFields = [],
}: SectionEditorProps) {
  const assignedProducts = section.product_ids
    .map((id) => products.find((p) => p.id === id))
    .filter(Boolean) as SectionProduct[]

  const availableProducts = products.filter(
    (p) => !section.product_ids.includes(p.id),
  )

  const [showProductPicker, setShowProductPicker] = useState(false)
  const [pickerQuery, setPickerQuery] = useState("")

  const normalizedQuery = pickerQuery.trim().toLowerCase()
  const filteredAvailable = normalizedQuery
    ? availableProducts.filter(
        (p) =>
          p.name.toLowerCase().includes(normalizedQuery) ||
          (p.slug?.toLowerCase().includes(normalizedQuery) ?? false),
      )
    : availableProducts
  // Only worth a search box once the list is long enough to scan.
  const showPickerSearch = availableProducts.length > 6

  const closePicker = () => {
    setShowProductPicker(false)
    setPickerQuery("")
  }

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

  const NO_FIELD = "__no_field__"
  const visibilityField = section.visible_if?.field_id
    ? visibilityFormFields.find((f) => f.name === section.visible_if?.field_id)
    : undefined
  // Stored value can be string or string[]; the picker only handles a single
  // value today. Array form is preserved untouched on read but the dropdown
  // shows the first match if present.
  const visibilityValue =
    typeof section.visible_if?.value === "string"
      ? section.visible_if?.value
      : Array.isArray(section.visible_if?.value)
        ? section.visible_if?.value[0]
        : undefined

  const handleVisibilityFieldChange = (nextFieldName: string) => {
    if (nextFieldName === NO_FIELD) {
      onUpdate(section.key, { visible_if: null })
      return
    }
    const field = visibilityFormFields.find((f) => f.name === nextFieldName)
    if (!field) return
    // Reset value when the field changes — options differ between fields.
    onUpdate(section.key, {
      visible_if: { field_id: field.name, value: field.options[0] ?? "" },
    })
  }

  const handleVisibilityValueChange = (nextValue: string) => {
    if (!section.visible_if?.field_id) return
    onUpdate(section.key, {
      visible_if: { field_id: section.visible_if.field_id, value: nextValue },
    })
  }

  const showTargeting =
    showAttendeeCategories || visibilityFormFields.length > 0

  const labelField = (
    <div className="flex flex-col gap-1">
      <Label
        htmlFor={`${section.key}-label`}
        className="text-xs font-medium text-muted-foreground"
      >
        Label
      </Label>
      <Input
        id={`${section.key}-label`}
        value={section.label}
        onChange={(e) => onUpdate(section.key, { label: e.target.value })}
        className="h-8 text-sm font-medium"
        placeholder="Section label"
      />
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      {showMediaFields ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="flex flex-col gap-1 sm:w-48 sm:shrink-0">
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
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {labelField}
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
                placeholder="Short description shown on the section card"
                className="min-h-[120px] max-h-[280px] text-sm"
              />
            </div>
          </div>
        </div>
      ) : (
        labelField
      )}

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium text-muted-foreground">
          Products ({assignedProducts.length})
        </Label>

        {assignedProducts.length > 0 && (
          <div className="flex flex-col divide-y rounded-md border">
            {assignedProducts.map((p) => {
              const inactive = p.is_active === false
              return (
                <div
                  key={p.id}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 text-xs",
                    inactive && "opacity-50",
                  )}
                >
                  <Package className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{p.name}</span>
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
                  <button
                    type="button"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${p.name}`}
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
        )}

        {availableProducts.length > 0 &&
          (showProductPicker ? (
            <div className="flex flex-col gap-2 rounded border p-2 bg-muted/30">
              {showPickerSearch && (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    placeholder="Search products"
                    className="h-7 pl-7 text-xs"
                  />
                </div>
              )}
              <div className="flex max-h-64 flex-col gap-1 overflow-auto">
                {filteredAvailable.map((p) => {
                  const inactive = p.is_active === false
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={cn(
                        "flex items-center gap-2 text-xs text-left py-1 px-1 rounded hover:bg-accent",
                        inactive && "opacity-50",
                      )}
                      onClick={() =>
                        onUpdate(section.key, {
                          product_ids: [...section.product_ids, p.id],
                        })
                      }
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
                {filteredAvailable.length === 0 && (
                  <p className="px-1 py-2 text-center text-xs text-muted-foreground">
                    No products match your search
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={closePicker}
              >
                Done
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
          ))}
      </div>

      {showTargeting && (
        <Collapsible className="group/targeting flex flex-col gap-2 pt-2">
          <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-data-[state=open]/targeting:rotate-180" />
            Targeting &amp; visibility
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-3">
            {showAttendeeCategories && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Visible to
                </Label>
                <div className="flex items-center gap-4">
                  {attendeeCategories.map(({ id, label }) => (
                    <div key={id} className="flex items-center gap-1.5">
                      <Checkbox
                        id={`${section.key}-cat-${id}`}
                        checked={(section.attendee_categories ?? []).includes(
                          id,
                        )}
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
            )}

            {visibilityFormFields.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Show only if
                </Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={section.visible_if?.field_id ?? NO_FIELD}
                    onValueChange={handleVisibilityFieldChange}
                  >
                    <SelectTrigger className="h-7 text-xs w-[200px]">
                      <SelectValue placeholder="No condition" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_FIELD}>No condition</SelectItem>
                      {visibilityFormFields.map((f) => (
                        <SelectItem key={f.name} value={f.name}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {visibilityField && visibilityField.options.length > 0 && (
                    <>
                      <span className="text-xs text-muted-foreground">
                        equals
                      </span>
                      <Select
                        value={visibilityValue ?? ""}
                        onValueChange={handleVisibilityValueChange}
                      >
                        <SelectTrigger className="h-7 text-xs w-[140px]">
                          <SelectValue placeholder="Select value" />
                        </SelectTrigger>
                        <SelectContent>
                          {visibilityField.options.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {opt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  )}
                </div>
                {!section.visible_if?.field_id && (
                  <span className="text-xs text-muted-foreground">
                    Always visible
                  </span>
                )}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
