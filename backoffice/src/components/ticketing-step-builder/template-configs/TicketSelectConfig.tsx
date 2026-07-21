import { useQuery } from "@tanstack/react-query"
import { Check } from "lucide-react"

import {
  AttendeeCategoriesService,
  FormFieldsService,
  ProductsService,
} from "@/client"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { SectionsEditor } from "./sections/SectionsEditor"
import {
  type ProductSection,
  parseConfigSections,
  type VisibilityFormFieldOption,
} from "./sections/sectionTypes"
import type { TemplateConfigProps } from "./types"

// Only fields with a fixed set of answers can drive section visibility.
// Free-text or date fields don't yield a stable dropdown of values.
const DISCRETE_FIELD_TYPES = new Set(["select", "checkbox", "radio"])

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

  const { data: categoriesData } = useQuery({
    queryKey: ["attendee-categories", popupId],
    queryFn: () =>
      AttendeeCategoriesService.listAttendeeCategories({ popupId }),
    enabled: !!popupId,
    staleTime: 0,
    refetchOnMount: "always",
  })

  const { data: formFieldsData } = useQuery({
    queryKey: ["form-fields", popupId],
    queryFn: () => FormFieldsService.listFormFields({ popupId, limit: 200 }),
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

  const formFieldsResults = Array.isArray(formFieldsData?.results)
    ? formFieldsData.results
    : []
  const visibilityFormFields: VisibilityFormFieldOption[] = formFieldsResults
    .filter(
      (f) =>
        DISCRETE_FIELD_TYPES.has(f.field_type) &&
        Array.isArray(f.options) &&
        f.options.length > 0,
    )
    .map((f) => ({
      name: f.name,
      label: f.label || f.name,
      options: f.options ?? [],
    }))

  const categoriesResults = Array.isArray(categoriesData?.results)
    ? categoriesData.results
    : []
  const attendeeCategories = [...categoriesResults]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((c) => {
      const meta = c.display_meta as Record<string, unknown> | undefined
      const label =
        meta?.label &&
        typeof meta.label === "string" &&
        meta.label.trim() !== ""
          ? meta.label
          : c.key.charAt(0).toUpperCase() + c.key.slice(1)
      return { id: c.id, key: c.key, label }
    })

  const updateSections = (sections: TicketSelectSection[]) => {
    onChange({ ...config, sections })
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

      <SectionsEditor
        sections={parsed.sections}
        onChange={updateSections}
        products={products}
        showMediaFields={false}
        showAttendeeCategories={true}
        attendeeCategories={attendeeCategories}
        visibilityFormFields={visibilityFormFields}
      />
    </div>
  )
}
