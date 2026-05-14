"use client"

import { Check, ChevronDown, Plus, ShoppingBag, Ticket } from "lucide-react"
import Image from "next/image"
import { useEffect, useState } from "react"
import AddAttendeeButtons from "@/components/checkout-flow/shared/AddAttendeeButtons"
import ExpandableDescription from "@/components/ui/ExpandableDescription"
import QuantitySelector, {
  resolveMaxQuantity,
  supportsQuantitySelector,
} from "@/components/ui/QuantitySelector"
import { deriveProductState, type ProductSaleState } from "@/lib/product-state"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import { usePassesProvider } from "@/providers/passesProvider"
import type { AttendeePassState } from "@/types/Attendee"
import { formatCurrency } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"
import type { VariantProps } from "../registries/variantRegistry"

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

interface TemplateSection {
  key: string
  label: string
  order: number
  product_ids: string[]
  attendee_categories?: string[] | null
}

const getCategoryMeta = (cat: string) => {
  // Fixed palette for well-known legacy category keys; generic fallback for all others
  const palette: Record<
    string,
    {
      label: string
      header: string
      accent: string
      badge: string
      tab: string
    }
  > = {
    main: {
      label: "Main",
      header: "bg-gray-900 text-white",
      accent: "border-l-gray-900",
      badge: "bg-gray-100 text-gray-800",
      tab: "text-gray-900 border-gray-900",
    },
    spouse: {
      label: "Spouse",
      header: "bg-indigo-600 text-white",
      accent: "border-l-indigo-600",
      badge: "bg-indigo-50 text-indigo-700",
      tab: "text-indigo-600 border-indigo-600",
    },
    kid: {
      label: "Kid",
      header: "bg-amber-500 text-white",
      accent: "border-l-amber-500",
      badge: "bg-amber-50 text-amber-700",
      tab: "text-amber-600 border-amber-500",
    },
  }
  return (
    palette[cat] ?? {
      label: cat.charAt(0).toUpperCase() + cat.slice(1),
      header: "bg-gray-700 text-white",
      accent: "border-l-gray-700",
      badge: "bg-gray-100 text-gray-700",
      tab: "text-gray-700 border-gray-700",
    }
  )
}

function SaleStateBadge({ state }: { state: ProductSaleState }) {
  if (state === "on_sale") return null
  const config: Record<
    Exclude<ProductSaleState, "on_sale">,
    { label: string; classes: string }
  > = {
    upcoming: {
      label: "UPCOMING",
      classes: "bg-blue-100 text-blue-700 border-blue-200",
    },
    ended: {
      label: "ENDED",
      classes: "bg-slate-100 text-slate-500 border-slate-200",
    },
    sold_out: {
      label: "SOLD OUT",
      classes: "bg-rose-100 text-rose-700 border-rose-200",
    },
  }
  const { label, classes } = config[state]
  return (
    <span
      className={cn(
        "px-2 py-0.5 text-[10px] font-semibold uppercase rounded tracking-wide border shrink-0",
        classes,
      )}
    >
      {label}
    </span>
  )
}

const sortProductsByPriority = (a: ProductsPass, b: ProductsPass): number => {
  const rank = (p: ProductsPass) => {
    if (p.duration_type === "full") return 0
    if (p.duration_type === "month") return 1
    if (p.duration_type === "week") return 2
    if (p.duration_type === "day") return 3
    return 4
  }
  return rank(a) - rank(b)
}

const stripedStyle = {
  backgroundImage:
    "repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(0,0,0,0.07) 3px, rgba(0,0,0,0.07) 6px)",
}

type TicketSelectVariant = "stacked" | "tabs" | "compact" | "accordion"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortedAttendees(attendees: AttendeePassState[]): AttendeePassState[] {
  // Sort: primary (main) first, then by the category string as a stable fallback.
  // Authoritative ordering by sort_order is enforced on the backend; the API
  // returns attendees with the main attendee first.
  return [...attendees].sort((a, b) => {
    const aIsMain = a.category === "main" ? 0 : 1
    const bIsMain = b.category === "main" ? 0 : 1
    if (aIsMain !== bIsMain) return aIsMain - bIsMain
    return (a.category ?? "").localeCompare(b.category ?? "")
  })
}

function _standardProducts(attendee: AttendeePassState): ProductsPass[] {
  return attendee.products
    .filter((p) => p.category !== "patreon")
    .sort(sortProductsByPriority)
}

function countSelected(attendee: AttendeePassState): number {
  return attendee.products.filter((p) => p.selected || p.purchased).length
}

// ---------------------------------------------------------------------------
// Empty-attendee suppression helper
// ---------------------------------------------------------------------------

/** True when an attendee has at least one renderable product:
 *  either purchased (must show Owned row in editing mode), or
 *  present in at least one section group (configurable product). */
function attendeeHasRenderableContent(
  attendee: AttendeePassState,
  sections: TemplateSection[],
): boolean {
  // Always show attendees who have purchased products.
  if (attendee.products.some((p) => p.purchased)) return true
  return buildSectionGroups(attendee, sections).length > 0
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function VariantTicketSelect({
  products,
  stepType,
  onSkip,
  templateConfig,
}: VariantProps) {
  const passesVariant: TicketSelectVariant =
    (templateConfig?.variant as TicketSelectVariant) || "stacked"
  const { attendeePasses, toggleProduct, isEditing } = usePassesProvider()
  const [focusedAttendeeId, setFocusedAttendeeId] = useState<string | null>(
    null,
  )

  const sections = parseSections(templateConfig)

  // Filter attendees with no renderable content before dispatching to layouts.
  // This covers all four layout variants in one place (DRY per design §4 ADR-6).
  const visibleAttendees = sortedAttendees(attendeePasses).filter((a) =>
    attendeeHasRenderableContent(a, sections),
  )

  // If no renderable attendees, fall back to legacy section-based layout.
  if (visibleAttendees.length === 0) {
    return (
      <LegacySectionLayout
        products={products}
        templateConfig={templateConfig}
        stepType={stepType}
        onSkip={onSkip}
      />
    )
  }

  const sharedProps = {
    attendees: visibleAttendees,
    toggleProduct,
    isEditing,
    sections,
    focusedAttendeeId,
  }

  const handleAttendeeAdded = (attendeeId: string) => {
    setFocusedAttendeeId(attendeeId)
  }

  return (
    <div className="space-y-4">
      <AddAttendeeButtons onAttendeeAdded={handleAttendeeAdded} />
      {passesVariant === "stacked" && <StackedLayout {...sharedProps} />}
      {passesVariant === "tabs" && <TabsLayout {...sharedProps} />}
      {passesVariant === "compact" && <CompactLayout {...sharedProps} />}
      {passesVariant === "accordion" && <AccordionLayout {...sharedProps} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared layout props
// ---------------------------------------------------------------------------

interface LayoutProps {
  attendees: AttendeePassState[]
  toggleProduct: (attendeeId: string, product: ProductsPass) => void
  isEditing: boolean
  sections: TemplateSection[]
  focusedAttendeeId?: string | null
}

/** Smooth-scroll to an attendee card. Defers one frame so layout updates settle first. */
function scrollToAttendeeCard(attendeeId: string) {
  requestAnimationFrame(() => {
    const el = document.getElementById(`attendee-card-${attendeeId}`)
    el?.scrollIntoView({ behavior: "smooth", block: "center" })
  })
}

// ---------------------------------------------------------------------------
// Template config helpers
// ---------------------------------------------------------------------------

function parseSections(
  templateConfig: VariantProps["templateConfig"],
): TemplateSection[] {
  const raw = templateConfig?.sections
  if (!Array.isArray(raw) || raw.length === 0) return []
  return [...(raw as TemplateSection[])].sort((a, b) => a.order - b.order)
}

/** Returns groups of products for an attendee based on configured sections.
 *  Products not in any section are excluded.
 *  Sections gated by attendee_categories are filtered to the current attendee. */
export function buildSectionGroups(
  attendee: AttendeePassState,
  sections: TemplateSection[],
): { section: TemplateSection; products: ProductsPass[] }[] {
  if (sections.length === 0) {
    // No config — fall back to duration-type grouping
    return buildDurationGroups(attendee)
  }

  const raw = attendee.category ?? ""
  const normalisedCategory = raw === "teen" || raw === "baby" ? "kid" : raw
  const visibleSections = sections.filter((s) => {
    if (s.attendee_categories == null) return true
    return s.attendee_categories.includes(normalisedCategory)
  })

  const productMap = new Map(
    attendee.products
      .filter((p) => p.category !== "patreon")
      .map((p) => [p.id, p]),
  )

  return visibleSections
    .map((section) => ({
      section,
      products: section.product_ids
        .map((id) => productMap.get(id))
        .filter(Boolean) as ProductsPass[],
    }))
    .filter((g) => g.products.length > 0)
}

/** Fallback: group by duration_type when no sections configured. */
function buildDurationGroups(
  attendee: AttendeePassState,
): { section: TemplateSection; products: ProductsPass[] }[] {
  const isChild =
    attendee.category === "kid" ||
    attendee.category === "teen" ||
    attendee.category === "baby"

  const all = attendee.products
    .filter((p) => p.category !== "patreon")
    .sort(sortProductsByPriority)

  const groups: { section: TemplateSection; products: ProductsPass[] }[] = []
  const add = (key: string, label: string, items: ProductsPass[]) => {
    if (items.length > 0)
      groups.push({
        section: { key, label, order: groups.length, product_ids: [] },
        products: items,
      })
  }
  if (!isChild) {
    add(
      "full",
      "Full Passes",
      all.filter((p) => p.duration_type === "full"),
    )
    add(
      "month",
      "Month Pass",
      all.filter((p) => p.duration_type === "month"),
    )
  }
  add(
    "week",
    "Weekly Passes",
    all.filter((p) => p.duration_type === "week"),
  )
  add(
    "day",
    "Day Passes",
    all.filter((p) => p.duration_type === "day"),
  )
  return groups
}

// ---------------------------------------------------------------------------
// Attendee card header
// ---------------------------------------------------------------------------

function AttendeeHeader({
  attendee,
  className,
}: {
  attendee: AttendeePassState
  className?: string
}) {
  const meta = getCategoryMeta(attendee.category ?? "")
  return (
    <div className={cn("px-5 py-3", meta.header, className)}>
      <p className="font-semibold text-sm leading-tight">{attendee.name}</p>
      <p className="text-xs opacity-70 mt-0.5">{meta.label}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pass rows for one attendee
// ---------------------------------------------------------------------------

function AttendeePassRows({
  attendee,
  toggleProduct,
  isEditing,
  sections,
}: {
  attendee: AttendeePassState
  toggleProduct: (id: string, p: ProductsPass) => void
  isEditing: boolean
  sections: TemplateSection[]
}) {
  const groups = buildSectionGroups(attendee, sections)

  const hasFullOrMonthSelected = attendee.products.some(
    (p) =>
      (p.duration_type === "full" || p.duration_type === "month") &&
      (p.purchased || p.selected),
  )

  if (groups.length === 0) {
    return (
      <div className="px-5 py-8 text-center text-sm text-muted-foreground">
        No passes available.
      </div>
    )
  }

  return (
    <>
      {groups.map(({ section, products: sectionProducts }) => (
        <PassSection key={section.key} label={section.label}>
          {sectionProducts.map((p) =>
            p.duration_type === "day" ? (
              <DayPassRow
                key={p.id}
                product={p}
                onQuantityChange={(qty) =>
                  toggleProduct(attendee.id, { ...p, quantity: qty })
                }
                disabled={hasFullOrMonthSelected}
                isEditing={isEditing}
              />
            ) : (
              <PassRow
                key={p.id}
                product={p}
                onClick={() => toggleProduct(attendee.id, p)}
                onQuantityChange={(qty) =>
                  toggleProduct(attendee.id, { ...p, quantity: qty })
                }
                isEditing={isEditing}
              />
            ),
          )}
        </PassSection>
      ))}
    </>
  )
}

function PassSection({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <>
      <div className="relative px-5 py-2 bg-gradient-to-r from-gray-100 via-gray-50 to-gray-100 overflow-hidden">
        <div className="absolute inset-0" style={stripedStyle} />
        <h4 className="relative text-xs font-semibold text-gray-600 uppercase tracking-wide">
          {label}
        </h4>
      </div>
      <div className="divide-y divide-border">{children}</div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Individual pass row
// ---------------------------------------------------------------------------

function PassRow({
  product,
  onClick,
  onQuantityChange,
  disabled,
  isEditing,
}: {
  product: ProductsPass
  onClick: () => void
  onQuantityChange?: (qty: number) => void
  disabled?: boolean
  isEditing: boolean
}) {
  const { purchased, selected } = product
  const isEditedForCredit = purchased && product.edit
  const comparePrice = product.compare_price ?? product.original_price
  const hasDiscount = comparePrice && comparePrice > product.price
  const isSelected = selected && !purchased
  const saleState = deriveProductState(product)
  const stateBlocked = saleState !== "on_sale"
  const effectiveDisabled = disabled || stateBlocked
  const isClickable = !effectiveDisabled && (!purchased || isEditing)
  const [summaryOpen, setSummaryOpen] = useState(false)
  // Multi-unit stepper mode — editing of purchased multi-unit passes is out
  // of scope (plan decision), so we only show the stepper for non-purchased rows.
  const showStepper =
    !!onQuantityChange &&
    supportsQuantitySelector(product.max_per_order) &&
    !purchased
  const currentQuantity = product.quantity ?? 0
  const maxQuantity = resolveMaxQuantity(product)

  if (purchased && !isEditing) {
    return (
      <div
        className="w-full px-5 py-3 flex items-center justify-between gap-4"
        style={{
          backgroundColor: "#f9f9f9",
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.03) 3px, rgba(0,0,0,0.03) 4px)",
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Ticket className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="font-medium text-muted-foreground truncate">
            {product.name}
          </span>
          <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-semibold uppercase rounded tracking-wide border border-slate-200 shrink-0">
            Owned
          </span>
        </div>
      </div>
    )
  }

  if (purchased && isEditing) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "w-full px-5 py-3 flex items-center justify-between gap-4 transition-all",
          isEditedForCredit
            ? "bg-orange-50 border-l-4 border-l-orange-400"
            : "bg-muted hover:bg-muted/80",
        )}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className={cn(
              "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 border-dashed",
              isEditedForCredit
                ? "bg-orange-100 border-orange-400"
                : "border-muted-foreground",
            )}
          >
            {isEditedForCredit && <Check className="w-3 h-3 text-orange-600" />}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-2">
              <Ticket
                className={cn(
                  "w-4 h-4 shrink-0",
                  isEditedForCredit
                    ? "text-orange-400"
                    : "text-muted-foreground",
                )}
              />
              <span
                className={cn(
                  "font-medium",
                  isEditedForCredit
                    ? "text-orange-700 line-through"
                    : "text-foreground",
                )}
              >
                {product.name}
              </span>
              <span
                className={cn(
                  "px-2 py-0.5 text-[10px] font-semibold uppercase rounded tracking-wide border",
                  isEditedForCredit
                    ? "bg-orange-100 text-orange-700 border-orange-300"
                    : "bg-slate-100 text-slate-500 border-slate-200",
                )}
              >
                {isEditedForCredit ? "Credit" : "Owned"}
              </span>
            </div>
          </div>
        </div>
        <p
          className={cn(
            "font-semibold shrink-0",
            isEditedForCredit ? "text-orange-600" : "text-muted-foreground",
          )}
        >
          {isEditedForCredit
            ? `+${formatCurrency(product.price)}`
            : formatCurrency(product.price)}
        </p>
      </button>
    )
  }

  const rowIsActive = showStepper ? currentQuantity > 0 : isSelected

  const handleRowClick = () => {
    if (!isClickable) return
    if (showStepper && onQuantityChange) {
      if (currentQuantity === 0 && currentQuantity < maxQuantity) {
        onQuantityChange(1)
      }
      return
    }
    onClick()
  }

  const mainButton = (
    <button
      type="button"
      onClick={isClickable ? handleRowClick : undefined}
      disabled={!isClickable}
      className={cn(
        "w-full px-5 py-3 flex items-center justify-between gap-4 transition-all border-l-[4px]",
        effectiveDisabled
          ? "opacity-40 cursor-not-allowed bg-muted border-l-transparent"
          : rowIsActive
            ? "bg-gradient-to-r from-primary/25 via-primary/[0.08] to-transparent border-l-primary"
            : "hover:bg-muted border-l-transparent",
      )}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {showStepper && onQuantityChange ? (
          <QuantitySelector
            size="sm"
            value={currentQuantity}
            min={0}
            max={maxQuantity}
            disabled={effectiveDisabled}
            onIncrement={() => onQuantityChange(currentQuantity + 1)}
            onDecrement={() => onQuantityChange(currentQuantity - 1)}
            onAdd={() => onQuantityChange(1)}
            className="shrink-0"
          />
        ) : (
          <div
            className={cn(
              "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all",
              isSelected
                ? "bg-primary border-primary"
                : effectiveDisabled
                  ? "border-border"
                  : "border-border",
            )}
          >
            {isSelected && (
              <Check className="w-3 h-3 text-primary-foreground" />
            )}
          </div>
        )}
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-start gap-2">
            <span className="font-medium text-foreground break-words">
              {product.name}
            </span>
            <SaleStateBadge state={saleState} />
          </div>
        </div>
      </div>
      <div className="text-right shrink-0">
        {hasDiscount && (
          <p className="text-xs text-muted-foreground line-through">
            {comparePrice != null ? formatCurrency(comparePrice) : ""}
          </p>
        )}
        <p
          className={cn(
            "text-foreground",
            rowIsActive ? "font-bold" : "font-semibold",
          )}
        >
          {formatCurrency(product.price)}
        </p>
      </div>
    </button>
  )

  const hasDescription = !!product.description

  if (hasDescription) {
    return (
      <div>
        {mainButton}
        <div className="px-5 pb-3 pt-2">
          {summaryOpen ? (
            <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
              {product.description}{" "}
              <button
                type="button"
                onClick={() => setSummaryOpen(false)}
                className="inline-flex items-center gap-0.5 font-medium text-primary underline underline-offset-2 hover:opacity-80 align-baseline"
              >
                Ver menos
                <ChevronDown className="w-3 h-3 rotate-180" />
              </button>
            </p>
          ) : (
            <div className="flex items-baseline gap-1.5">
              <p className="text-xs text-muted-foreground truncate flex-1 min-w-0">
                {product.description}
              </p>
              <button
                type="button"
                onClick={() => setSummaryOpen(true)}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-primary underline underline-offset-2 hover:opacity-80 shrink-0"
              >
                Ver más
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return mainButton
}

// ---------------------------------------------------------------------------
// Day pass row with quantity stepper
// ---------------------------------------------------------------------------

function DayPassRow({
  product,
  onQuantityChange,
  disabled,
  isEditing,
}: {
  product: ProductsPass
  onQuantityChange: (qty: number) => void
  disabled?: boolean
  isEditing: boolean
}) {
  const { purchased } = product
  const isEditedForCredit = purchased && product.edit
  const quantity = product.quantity ?? 0
  const originalQuantity = product.original_quantity ?? 0
  const comparePrice = product.compare_price ?? product.price
  const hasDiscount = comparePrice != null && comparePrice > product.price
  const hasQuantity = quantity > 0
  const saleState = deriveProductState(product)
  const stateBlocked = saleState !== "on_sale"
  const effectiveDisabled = disabled || stateBlocked

  const maxQuantity = resolveMaxQuantity(product)

  const minQuantity = purchased && !isEditing ? originalQuantity : 0

  if (purchased && isEditing) {
    const credit = product.price * (product.quantity ?? 1)
    return (
      <button
        type="button"
        onClick={() =>
          onQuantityChange(isEditedForCredit ? originalQuantity : 0)
        }
        className={cn(
          "w-full px-5 py-3 flex items-center justify-between gap-4 transition-all",
          isEditedForCredit
            ? "bg-orange-50 border-l-4 border-l-orange-400"
            : "bg-muted hover:bg-muted/80",
        )}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className={cn(
              "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 border-dashed",
              isEditedForCredit
                ? "bg-orange-100 border-orange-400"
                : "border-muted-foreground",
            )}
          >
            {isEditedForCredit && <Check className="w-3 h-3 text-orange-600" />}
          </div>
          <span
            className={cn(
              "font-medium",
              isEditedForCredit
                ? "text-orange-700 line-through"
                : "text-foreground",
            )}
          >
            {product.name} ({originalQuantity}{" "}
            {originalQuantity === 1 ? "day" : "days"})
          </span>
        </div>
        <p
          className={cn(
            "font-semibold shrink-0",
            isEditedForCredit ? "text-orange-600" : "text-muted-foreground",
          )}
        >
          {isEditedForCredit
            ? `+${formatCurrency(credit)}`
            : formatCurrency(credit)}
        </p>
      </button>
    )
  }

  return (
    <div
      className={cn(
        "px-5 py-3 flex items-center justify-between gap-4 border-l-[4px]",
        effectiveDisabled
          ? "opacity-40 border-l-transparent"
          : hasQuantity
            ? "bg-gradient-to-r from-primary/25 via-primary/[0.08] to-transparent border-l-primary"
            : "border-l-transparent",
      )}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <QuantitySelector
          size="sm"
          value={quantity}
          min={minQuantity}
          max={maxQuantity}
          disabled={effectiveDisabled}
          onIncrement={() => onQuantityChange(quantity + 1)}
          onDecrement={() => onQuantityChange(quantity - 1)}
          onAdd={() => onQuantityChange(1)}
          className="shrink-0"
        />
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-start gap-2">
            <span className="font-medium text-foreground break-words">
              {product.name}
            </span>
            <SaleStateBadge state={saleState} />
          </div>
          <p className="text-sm text-muted-foreground">per day</p>
          {product.description && (
            <ExpandableDescription
              text={product.description}
              clamp={2}
              className="text-xs text-muted-foreground mt-1"
            />
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        {hasDiscount && (
          <p className="text-xs text-muted-foreground line-through">
            {comparePrice != null ? formatCurrency(comparePrice) : ""}
          </p>
        )}
        <p
          className={cn(
            "font-semibold",
            hasQuantity ? "text-primary" : "text-foreground",
          )}
        >
          {formatCurrency(product.price)}
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Compact pill row (used in compact variant)
// ---------------------------------------------------------------------------

function CompactAttendeeCard({
  attendee,
  toggleProduct,
  isEditing,
  sections,
}: {
  attendee: AttendeePassState
  toggleProduct: (id: string, p: ProductsPass) => void
  isEditing: boolean
  sections: TemplateSection[]
}) {
  const meta = getCategoryMeta(attendee.category ?? "")
  const groups = buildSectionGroups(attendee, sections)
  const visibleProducts = groups.flatMap((g) => g.products)

  const hasFullOrMonthSelected = attendee.products.some(
    (p) =>
      (p.duration_type === "full" || p.duration_type === "month") &&
      (p.purchased || p.selected),
  )

  return (
    <div
      className={cn(
        "bg-checkout-card-bg rounded-xl border border-border shadow-sm p-3 border-l-2",
        meta.accent,
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2.5">
        <div
          className={cn(
            "px-2 py-0.5 rounded-full text-xs font-semibold",
            meta.header,
          )}
        >
          {meta.label}
        </div>
        <span className="text-sm font-medium text-foreground">
          {attendee.name}
        </span>
      </div>

      {visibleProducts.length === 0 ? (
        <p className="text-xs text-muted-foreground">No passes available.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {visibleProducts.map((p) => {
            const isDayPass = p.duration_type === "day"
            const hasStepper =
              isDayPass || supportsQuantitySelector(p.max_per_order)
            const pillSaleState = deriveProductState(p)
            const pillStateBlocked = pillSaleState !== "on_sale"

            if (hasStepper) {
              const qty = p.quantity ?? 0
              const max = resolveMaxQuantity(p)
              const minQty =
                isDayPass && p.purchased && !isEditing
                  ? (p.original_quantity ?? 0)
                  : 0
              // Mirror the pill-level disabling used by the non-day branch below.
              const isChild =
                attendee.category === "kid" ||
                attendee.category === "teen" ||
                attendee.category === "baby"
              const tileDisabled =
                !!p.disabled ||
                pillStateBlocked ||
                (!isDayPass &&
                  isChild &&
                  (p.duration_type === "full" ||
                    p.duration_type === "month")) ||
                (p.duration_type === "week" && hasFullOrMonthSelected) ||
                (p.duration_type === "day" && hasFullOrMonthSelected) ||
                (p.purchased && !isEditing)

              return (
                <div
                  key={p.id}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-medium transition-all",
                    qty > 0
                      ? "bg-primary/10 border-primary/30"
                      : "bg-checkout-card-bg border-border",
                    tileDisabled && "opacity-40",
                  )}
                >
                  <QuantitySelector
                    size="sm"
                    value={qty}
                    min={minQty}
                    max={max}
                    disabled={tileDisabled}
                    onIncrement={() =>
                      toggleProduct(attendee.id, { ...p, quantity: qty + 1 })
                    }
                    onDecrement={() =>
                      toggleProduct(attendee.id, { ...p, quantity: qty - 1 })
                    }
                    onAdd={() =>
                      toggleProduct(attendee.id, { ...p, quantity: 1 })
                    }
                  />
                  <Ticket
                    className={cn(
                      "w-3 h-3 ml-0.5",
                      qty > 0 ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <span
                    className={
                      qty > 0 ? "text-primary" : "text-muted-foreground"
                    }
                  >
                    {p.name}
                  </span>
                  <SaleStateBadge state={pillSaleState} />
                  <span
                    className={cn(
                      "font-semibold ml-0.5",
                      qty > 0 ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {formatCurrency(p.price)}
                  </span>
                </div>
              )
            }

            const isChild =
              attendee.category === "kid" ||
              attendee.category === "teen" ||
              attendee.category === "baby"
            const isDisabled =
              p.disabled ||
              pillStateBlocked ||
              (isChild &&
                (p.duration_type === "full" || p.duration_type === "month")) ||
              (p.duration_type === "week" && hasFullOrMonthSelected) ||
              (p.purchased && !isEditing)

            const isSelected = p.selected && !p.purchased

            return (
              <button
                key={p.id}
                type="button"
                onClick={
                  isDisabled ? undefined : () => toggleProduct(attendee.id, p)
                }
                disabled={isDisabled}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                  p.purchased && !isEditing
                    ? "bg-muted border-border text-muted-foreground cursor-not-allowed"
                    : isSelected
                      ? "bg-primary border-primary text-primary-foreground shadow-sm"
                      : isDisabled
                        ? "bg-muted border-border text-muted-foreground cursor-not-allowed opacity-50"
                        : "bg-checkout-card-bg border-border text-foreground hover:border-muted-foreground/40 hover:bg-muted",
                )}
              >
                {isSelected && <Check className="w-3 h-3" />}
                {p.purchased && !isEditing && <Ticket className="w-3 h-3" />}
                <span>{p.name}</span>
                <SaleStateBadge state={pillSaleState} />
                <span
                  className={cn(
                    "font-semibold",
                    isSelected ? "opacity-80" : "",
                  )}
                >
                  {formatCurrency(p.price)}
                </span>
                {p.purchased && !isEditing && (
                  <span className="text-[10px] uppercase tracking-wide opacity-60">
                    owned
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Layout A: Stacked
// ---------------------------------------------------------------------------

function StackedLayout({
  attendees,
  toggleProduct,
  isEditing,
  sections,
  focusedAttendeeId,
}: LayoutProps) {
  useEffect(() => {
    if (focusedAttendeeId) scrollToAttendeeCard(focusedAttendeeId)
  }, [focusedAttendeeId])

  return (
    <div className="space-y-3">
      {attendees.map((attendee) => (
        <div
          key={attendee.id}
          id={`attendee-card-${attendee.id}`}
          className="bg-checkout-card-bg rounded-2xl shadow-sm border border-border overflow-hidden"
        >
          <AttendeeHeader attendee={attendee} />
          <AttendeePassRows
            attendee={attendee}
            toggleProduct={toggleProduct}
            isEditing={isEditing}
            sections={sections}
          />
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Layout B: Tabs
// ---------------------------------------------------------------------------

function TabsLayout({
  attendees,
  toggleProduct,
  isEditing,
  sections,
  focusedAttendeeId,
}: LayoutProps) {
  const [activeIdx, setActiveIdx] = useState(0)
  const active = attendees[activeIdx]

  useEffect(() => {
    if (!focusedAttendeeId) return
    const idx = attendees.findIndex((a) => a.id === focusedAttendeeId)
    if (idx >= 0) {
      setActiveIdx(idx)
      scrollToAttendeeCard(focusedAttendeeId)
    }
  }, [focusedAttendeeId, attendees])

  return (
    <div className="bg-checkout-card-bg rounded-2xl shadow-sm border border-border overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-border bg-muted/50 overflow-x-auto">
        {attendees.map((a, idx) => {
          const meta = getCategoryMeta(a.category ?? "")
          const isActive = idx === activeIdx
          const selected = countSelected(a)
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setActiveIdx(idx)}
              className={cn(
                "flex-1 min-w-max flex flex-col items-center px-4 py-2.5 text-xs font-medium transition-all border-b-2 whitespace-nowrap",
                isActive
                  ? cn(meta.tab, "bg-card")
                  : "text-muted-foreground border-transparent hover:text-foreground hover:bg-muted",
              )}
            >
              <span className="font-semibold text-sm leading-tight">
                {a.name}
              </span>
              <span className="opacity-70">{meta.label}</span>
              {selected > 0 && (
                <span
                  className={cn(
                    "mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-semibold",
                    isActive ? meta.badge : "bg-muted text-muted-foreground",
                  )}
                >
                  {selected} selected
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Content */}
      {active && (
        <div id={`attendee-card-${active.id}`}>
          <AttendeePassRows
            attendee={active}
            toggleProduct={toggleProduct}
            isEditing={isEditing}
            sections={sections}
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Layout C: Compact
// ---------------------------------------------------------------------------

function CompactLayout({
  attendees,
  toggleProduct,
  isEditing,
  sections,
  focusedAttendeeId,
}: LayoutProps) {
  useEffect(() => {
    if (focusedAttendeeId) scrollToAttendeeCard(focusedAttendeeId)
  }, [focusedAttendeeId])

  return (
    <div className="space-y-3">
      {attendees.map((a) => (
        <div key={a.id} id={`attendee-card-${a.id}`}>
          <CompactAttendeeCard
            attendee={a}
            toggleProduct={toggleProduct}
            isEditing={isEditing}
            sections={sections}
          />
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Layout D: Accordion
// ---------------------------------------------------------------------------

function AccordionLayout({
  attendees,
  toggleProduct,
  isEditing,
  sections,
  focusedAttendeeId,
}: LayoutProps) {
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(attendees[0] ? [attendees[0].id] : []),
  )

  const toggleOpen = (id: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useEffect(() => {
    if (!focusedAttendeeId) return
    setOpen((prev) => {
      if (prev.has(focusedAttendeeId)) return prev
      const next = new Set(prev)
      next.add(focusedAttendeeId)
      return next
    })
    scrollToAttendeeCard(focusedAttendeeId)
  }, [focusedAttendeeId])

  return (
    <div className="space-y-2">
      {attendees.map((attendee) => {
        const meta = getCategoryMeta(attendee.category ?? "")
        const isOpen = open.has(attendee.id)
        const selected = countSelected(attendee)

        return (
          <div
            key={attendee.id}
            id={`attendee-card-${attendee.id}`}
            className="bg-checkout-card-bg rounded-2xl border border-border shadow-sm overflow-hidden"
          >
            <button
              type="button"
              onClick={() => toggleOpen(attendee.id)}
              className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/80 transition-colors"
            >
              {/* Color dot */}
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-bold",
                  meta.header,
                )}
              >
                {attendee.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="font-semibold text-foreground text-sm truncate">
                  {attendee.name}
                </p>
                <p className="text-xs text-muted-foreground">{meta.label}</p>
              </div>
              {selected > 0 && (
                <span
                  className={cn(
                    "text-xs px-2 py-0.5 rounded-full font-semibold mr-1 shrink-0",
                    meta.badge,
                  )}
                >
                  {selected} selected
                </span>
              )}
              <ChevronDown
                className={cn(
                  "w-4 h-4 text-muted-foreground transition-transform duration-200 shrink-0",
                  isOpen && "rotate-180",
                )}
              />
            </button>

            {isOpen && (
              <div className="border-t border-border">
                <AttendeePassRows
                  attendee={attendee}
                  toggleProduct={toggleProduct}
                  isEditing={isEditing}
                  sections={sections}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Legacy: section-based layout (fallback when passesProvider has no data)
// ---------------------------------------------------------------------------

function groupBySection(
  products: ProductsPass[],
  sections: TemplateSection[],
): { section: TemplateSection; products: ProductsPass[] }[] {
  const groups: { section: TemplateSection; products: ProductsPass[] }[] = []
  for (const section of [...sections].sort((a, b) => a.order - b.order)) {
    const sectionProducts = section.product_ids
      .map((id) => products.find((p) => p.id === id))
      .filter(Boolean) as ProductsPass[]
    if (sectionProducts.length > 0)
      groups.push({ section, products: sectionProducts })
  }
  const assignedIds = new Set(sections.flatMap((s) => s.product_ids))
  const unassigned = products.filter((p) => !assignedIds.has(p.id))
  if (unassigned.length > 0) {
    groups.push({
      section: { key: "__other", label: "Other", order: 999, product_ids: [] },
      products: unassigned,
    })
  }
  return groups
}

function LegacySectionLayout({
  products,
  templateConfig,
  stepType,
}: {
  products: ProductsPass[]
  templateConfig: VariantProps["templateConfig"]
  stepType: string
  onSkip?: () => void
}) {
  const { cart, addDynamicItem, removeDynamicItem, updateDynamicQuantity } =
    useCheckout()
  const items = cart.dynamicItems[stepType] ?? []
  const getQuantity = (id: string): number =>
    items.find((i) => i.productId === id)?.quantity ?? 0

  const handleAdd = (p: ProductsPass, qty: number = 1) => {
    addDynamicItem(stepType, {
      productId: p.id,
      product: p,
      quantity: qty,
      price: p.price,
      stepType,
    })
  }

  const handleQuantityChange = (p: ProductsPass, qty: number) => {
    if (qty <= 0) {
      removeDynamicItem(stepType, p.id)
      return
    }
    if (getQuantity(p.id) === 0) {
      handleAdd(p, qty)
      return
    }
    updateDynamicQuantity(stepType, p.id, qty)
  }

  const sections = (templateConfig?.sections ?? null) as
    | TemplateSection[]
    | null
  const hasSections = Array.isArray(sections) && sections.length > 0
  const groups = hasSections ? groupBySection(products, sections) : null

  const renderItem = (p: ProductsPass) => {
    const quantity = getQuantity(p.id)
    const isAdded = quantity > 0
    const showStepper = supportsQuantitySelector(p.max_per_order)
    const max = resolveMaxQuantity({
      max_per_order: p.max_per_order,
      total_stock_remaining: p.total_stock_remaining,
    })
    const total = isAdded ? p.price * quantity : p.price
    const hasDiscount = p.compare_price != null && p.compare_price > p.price

    return (
      <div
        key={p.id}
        className={cn("p-4 transition-colors", isAdded ? "bg-primary/10" : "")}
      >
        <div className="flex items-center gap-3">
          <div className="relative w-14 h-14 shrink-0 rounded-xl overflow-hidden bg-muted flex items-center justify-center">
            {p.image_url ? (
              <Image
                src={p.image_url}
                alt={p.name}
                fill
                className="object-cover"
              />
            ) : (
              <ShoppingBag className="w-6 h-6 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-foreground text-sm">{p.name}</h3>
            </div>
            {p.description && (
              <ExpandableDescription
                text={p.description}
                clamp={2}
                className="text-xs text-muted-foreground mt-0.5"
              />
            )}
          </div>
          {showStepper ? (
            <QuantitySelector
              size="md"
              value={quantity}
              min={0}
              max={max}
              onIncrement={() => handleQuantityChange(p, quantity + 1)}
              onDecrement={() =>
                handleQuantityChange(p, Math.max(0, quantity - 1))
              }
              onAdd={() => handleAdd(p, 1)}
            />
          ) : (
            <button
              type="button"
              onClick={() =>
                isAdded ? removeDynamicItem(stepType, p.id) : handleAdd(p, 1)
              }
              aria-label={isAdded ? "Remove from cart" : "Add to cart"}
              className={cn(
                "h-8 px-3 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 shrink-0",
                isAdded
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-card border border-border text-foreground hover:bg-muted",
              )}
            >
              {isAdded ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Added
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </>
              )}
            </button>
          )}
          <div className="text-right shrink-0 min-w-16">
            {isAdded && quantity > 1 && (
              <p className="text-xs text-muted-foreground">
                {quantity} × {formatCurrency(p.price)}
              </p>
            )}
            {hasDiscount && p.compare_price != null && (
              <p className="text-xs text-muted-foreground line-through">
                {formatCurrency(p.compare_price)}
              </p>
            )}
            <span
              className={cn(
                "font-semibold text-sm",
                isAdded ? "text-primary" : "text-foreground",
              )}
            >
              {formatCurrency(total)}
            </span>
          </div>
        </div>
      </div>
    )
  }

  const renderGroup = (
    section: TemplateSection,
    items: ProductsPass[],
    showHeader: boolean,
  ) => (
    <div
      key={section.key}
      className="bg-checkout-card-bg rounded-2xl shadow-sm border border-border overflow-hidden divide-y divide-border"
    >
      {showHeader && (
        <div className="px-5 py-2 bg-muted/30">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {section.label}
          </h4>
        </div>
      )}
      {items.map(renderItem)}
    </div>
  )

  return (
    <div className="space-y-4">
      {groups
        ? groups.map(({ section, products: sp }) =>
            renderGroup(section, sp, groups.length > 1),
          )
        : products.length > 0 && (
            <div className="bg-checkout-card-bg rounded-2xl shadow-sm border border-border overflow-hidden divide-y divide-border">
              {products.map(renderItem)}
            </div>
          )}
    </div>
  )
}
