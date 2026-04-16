"use client"

import { Check, ChevronDown, Ticket } from "lucide-react"
import { useEffect, useState } from "react"
import AddAttendeeButtons from "@/components/checkout-flow/shared/AddAttendeeButtons"
import ExpandableDescription from "@/components/ui/ExpandableDescription"
import QuantitySelector, {
  resolveMaxQuantity,
  supportsQuantitySelector,
} from "@/components/ui/QuantitySelector"
import { formatDate } from "@/helpers/dates"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import { usePassesProvider } from "@/providers/passesProvider"
import type { AttendeePassState } from "@/types/Attendee"
import { formatCheckoutDate, formatCurrency } from "@/types/checkout"
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
}

const CATEGORY_ORDER = ["main", "spouse", "kid", "teen", "baby"]

const CATEGORY_META: Record<
  string,
  { label: string; header: string; accent: string; badge: string; tab: string }
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
  teen: {
    label: "Teen",
    header: "bg-amber-500 text-white",
    accent: "border-l-amber-500",
    badge: "bg-amber-50 text-amber-700",
    tab: "text-amber-600 border-amber-500",
  },
  baby: {
    label: "Baby",
    header: "bg-amber-400 text-white",
    accent: "border-l-amber-400",
    badge: "bg-amber-50 text-amber-600",
    tab: "text-amber-500 border-amber-400",
  },
}

const getCategoryMeta = (cat: string) =>
  CATEGORY_META[cat] ?? {
    label: cat.charAt(0).toUpperCase() + cat.slice(1),
    header: "bg-gray-700 text-white",
    accent: "border-l-gray-700",
    badge: "bg-gray-100 text-gray-700",
    tab: "text-gray-700 border-gray-700",
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
  return [...attendees].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a.category)
    const ib = CATEGORY_ORDER.indexOf(b.category)
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
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

  // If no attendee data, fall back to legacy section-based layout
  if (attendeePasses.length === 0) {
    return (
      <LegacySectionLayout
        products={products}
        templateConfig={templateConfig}
        stepType={stepType}
        onSkip={onSkip}
      />
    )
  }

  const attendees = sortedAttendees(attendeePasses)

  const sections = parseSections(templateConfig)
  const sharedProps = {
    attendees,
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
 *  Products not in any section are excluded. */
function buildSectionGroups(
  attendee: AttendeePassState,
  sections: TemplateSection[],
): { section: TemplateSection; products: ProductsPass[] }[] {
  if (sections.length === 0) {
    // No config — fall back to duration-type grouping
    return buildDurationGroups(attendee)
  }

  const productMap = new Map(
    attendee.products
      .filter((p) => p.category !== "patreon")
      .map((p) => [p.id, p]),
  )

  return sections
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
  const meta = getCategoryMeta(attendee.category)
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
      <div className="px-5 py-8 text-center text-sm text-gray-400">
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
        <h4 className="relative text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {label}
        </h4>
      </div>
      <div className="divide-y divide-gray-100">{children}</div>
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
  const isClickable = !disabled && (!purchased || isEditing)
  // Multi-unit stepper mode — editing of purchased multi-unit passes is out
  // of scope (plan decision), so we only show the stepper for non-purchased rows.
  const showStepper =
    !!onQuantityChange &&
    supportsQuantitySelector(product.max_quantity) &&
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
          <Ticket className="w-4 h-4 text-gray-300 shrink-0" />
          <span className="font-medium text-gray-400 truncate">
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
            : "bg-gray-50 hover:bg-gray-100",
        )}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className={cn(
              "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 border-dashed",
              isEditedForCredit
                ? "bg-orange-100 border-orange-400"
                : "border-gray-400",
            )}
          >
            {isEditedForCredit && <Check className="w-3 h-3 text-orange-600" />}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-2">
              <Ticket
                className={cn(
                  "w-4 h-4",
                  isEditedForCredit ? "text-orange-400" : "text-gray-400",
                )}
              />
              <span
                className={cn(
                  "font-medium",
                  isEditedForCredit
                    ? "text-orange-700 line-through"
                    : "text-gray-700",
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
            isEditedForCredit ? "text-orange-600" : "text-gray-500",
          )}
        >
          {isEditedForCredit
            ? `+$${product.price.toLocaleString()}`
            : `$${product.price.toLocaleString()}`}
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

  return (
    <button
      type="button"
      onClick={isClickable ? handleRowClick : undefined}
      disabled={!isClickable}
      className={cn(
        "w-full px-5 py-3 flex items-center justify-between gap-4 transition-all",
        disabled
          ? "opacity-40 cursor-not-allowed bg-gray-50"
          : rowIsActive
            ? "bg-blue-50"
            : "hover:bg-gray-50",
      )}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {showStepper && onQuantityChange ? (
          <QuantitySelector
            size="sm"
            value={currentQuantity}
            min={0}
            max={maxQuantity}
            disabled={!!disabled}
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
                ? "bg-blue-600 border-blue-600"
                : disabled
                  ? "border-gray-200"
                  : "border-gray-300",
            )}
          >
            {isSelected && <Check className="w-3 h-3 text-white" />}
          </div>
        )}
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <Ticket className="w-4 h-4 text-gray-400" />
            <span className="font-medium text-gray-900">{product.name}</span>
          </div>
          {product.start_date && product.end_date && (
            <p className="text-sm text-gray-500">
              {formatDate(product.start_date, {
                day: "numeric",
                month: "short",
              })}
              {" – "}
              {formatDate(product.end_date, { day: "numeric", month: "short" })}
            </p>
          )}
          {product.description && (
            <ExpandableDescription
              text={product.description}
              clamp={2}
              className="text-xs text-gray-500 mt-1"
            />
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        {hasDiscount && (
          <p className="text-xs text-gray-400 line-through">
            ${comparePrice?.toLocaleString()}
          </p>
        )}
        <p
          className={cn(
            "font-semibold",
            rowIsActive ? "text-blue-600" : "text-gray-900",
          )}
        >
          ${product.price.toLocaleString()}
        </p>
      </div>
    </button>
  )
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

  const maxQuantity = resolveMaxQuantity(product, {
    dayPassFallbackToDateRange: true,
  })

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
            : "bg-gray-50 hover:bg-gray-100",
        )}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className={cn(
              "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 border-dashed",
              isEditedForCredit
                ? "bg-orange-100 border-orange-400"
                : "border-gray-400",
            )}
          >
            {isEditedForCredit && <Check className="w-3 h-3 text-orange-600" />}
          </div>
          <span
            className={cn(
              "font-medium",
              isEditedForCredit
                ? "text-orange-700 line-through"
                : "text-gray-700",
            )}
          >
            {product.name} ({originalQuantity}{" "}
            {originalQuantity === 1 ? "day" : "days"})
          </span>
        </div>
        <p
          className={cn(
            "font-semibold shrink-0",
            isEditedForCredit ? "text-orange-600" : "text-gray-500",
          )}
        >
          {isEditedForCredit
            ? `+$${credit.toLocaleString()}`
            : `$${credit.toLocaleString()}`}
        </p>
      </button>
    )
  }

  return (
    <div
      className={cn(
        "px-5 py-3 flex items-center justify-between gap-4",
        disabled ? "opacity-40" : hasQuantity ? "bg-blue-50" : "",
      )}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <QuantitySelector
          size="sm"
          value={quantity}
          min={minQuantity}
          max={maxQuantity}
          disabled={!!disabled}
          onIncrement={() => onQuantityChange(quantity + 1)}
          onDecrement={() => onQuantityChange(quantity - 1)}
          onAdd={() => onQuantityChange(1)}
          className="shrink-0"
        />
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <Ticket className="w-4 h-4 text-gray-400" />
            <span className="font-medium text-gray-900">{product.name}</span>
          </div>
          <p className="text-sm text-gray-500">per day</p>
          {product.description && (
            <ExpandableDescription
              text={product.description}
              clamp={2}
              className="text-xs text-gray-500 mt-1"
            />
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        {hasDiscount && (
          <p className="text-xs text-gray-400 line-through">
            ${comparePrice?.toLocaleString()}
          </p>
        )}
        <p
          className={cn(
            "font-semibold",
            hasQuantity ? "text-blue-600" : "text-gray-900",
          )}
        >
          ${product.price.toLocaleString()}
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
  const meta = getCategoryMeta(attendee.category)
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
        "bg-white rounded-xl border border-gray-100 shadow-sm p-3 border-l-2",
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
        <span className="text-sm font-medium text-gray-700">
          {attendee.name}
        </span>
      </div>

      {visibleProducts.length === 0 ? (
        <p className="text-xs text-gray-400">No passes available.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {visibleProducts.map((p) => {
            const isDayPass = p.duration_type === "day"
            const hasStepper =
              isDayPass || supportsQuantitySelector(p.max_quantity)

            if (hasStepper) {
              const qty = p.quantity ?? 0
              const max = resolveMaxQuantity(p, {
                dayPassFallbackToDateRange: isDayPass,
              })
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
                      ? "bg-blue-50 border-blue-300"
                      : "bg-white border-gray-200",
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
                      qty > 0 ? "text-blue-500" : "text-gray-300",
                    )}
                  />
                  <span className={qty > 0 ? "text-blue-700" : "text-gray-600"}>
                    {p.name}
                  </span>
                  <span
                    className={cn(
                      "font-semibold ml-0.5",
                      qty > 0 ? "text-blue-600" : "text-gray-500",
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
                    ? "bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed"
                    : isSelected
                      ? "bg-blue-600 border-blue-600 text-white shadow-sm"
                      : isDisabled
                        ? "bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed opacity-50"
                        : "bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50",
                )}
              >
                {isSelected && <Check className="w-3 h-3" />}
                {p.purchased && !isEditing && <Ticket className="w-3 h-3" />}
                <span>{p.name}</span>
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
          className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden"
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
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-gray-100 bg-gray-50/50 overflow-x-auto">
        {attendees.map((a, idx) => {
          const meta = getCategoryMeta(a.category)
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
                  ? cn(meta.tab, "bg-white")
                  : "text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-50",
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
                    isActive ? meta.badge : "bg-gray-100 text-gray-500",
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
        const meta = getCategoryMeta(attendee.category)
        const isOpen = open.has(attendee.id)
        const selected = countSelected(attendee)

        return (
          <div
            key={attendee.id}
            id={`attendee-card-${attendee.id}`}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
          >
            <button
              type="button"
              onClick={() => toggleOpen(attendee.id)}
              className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50/80 transition-colors"
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
                <p className="font-semibold text-gray-900 text-sm truncate">
                  {attendee.name}
                </p>
                <p className="text-xs text-gray-400">{meta.label}</p>
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
                  "w-4 h-4 text-gray-400 transition-transform duration-200 shrink-0",
                  isOpen && "rotate-180",
                )}
              />
            </button>

            {isOpen && (
              <div className="border-t border-gray-100">
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
  onSkip,
}: {
  products: ProductsPass[]
  templateConfig: VariantProps["templateConfig"]
  stepType: string
  onSkip?: () => void
}) {
  const { cart, addDynamicItem, removeDynamicItem } = useCheckout()
  const items = cart.dynamicItems[stepType] ?? []
  const isSelected = (id: string) => items.some((i) => i.productId === id)
  const toggle = (p: ProductsPass) => {
    if (isSelected(p.id)) removeDynamicItem(stepType, p.id)
    else
      addDynamicItem(stepType, {
        productId: p.id,
        product: p,
        quantity: 1,
        price: p.price,
        stepType,
      })
  }

  const sections = (templateConfig?.sections ?? null) as
    | TemplateSection[]
    | null
  const hasSections = Array.isArray(sections) && sections.length > 0
  const groups = hasSections ? groupBySection(products, sections) : null

  const renderRow = (p: ProductsPass) => {
    const selected = isSelected(p.id)
    return (
      <button
        key={p.id}
        type="button"
        onClick={() => toggle(p)}
        className={cn(
          "w-full p-4 flex items-center gap-3 text-left transition-colors",
          selected ? "bg-blue-50/50" : "hover:bg-gray-50",
        )}
      >
        <div
          className={cn(
            "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
            selected ? "border-blue-600 bg-blue-600" : "border-gray-300",
          )}
        >
          {selected && <Check className="w-3 h-3 text-white" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900 text-sm">{p.name}</p>
          {p.description && (
            <ExpandableDescription
              text={p.description}
              clamp={2}
              className="text-xs text-gray-500 mt-0.5"
            />
          )}
          {(p.start_date || p.end_date) && (
            <p className="text-xs text-gray-400 mt-0.5">
              {p.start_date && formatCheckoutDate(p.start_date)}
              {p.start_date && p.end_date && " – "}
              {p.end_date && formatCheckoutDate(p.end_date)}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          {p.compare_price != null && p.compare_price > p.price && (
            <p className="text-xs text-gray-400 line-through">
              {formatCurrency(p.compare_price)}
            </p>
          )}
          <span
            className={cn(
              "font-semibold text-sm",
              selected ? "text-blue-600" : "text-gray-700",
            )}
          >
            {formatCurrency(p.price)}
          </span>
        </div>
      </button>
    )
  }

  return (
    <div className="space-y-4">
      {groups ? (
        <div className="space-y-4">
          {groups.map(({ section, products: sp }) => (
            <div
              key={section.key}
              className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden"
            >
              <div
                className="relative px-5 py-2 bg-gradient-to-r from-gray-100 via-gray-50 to-gray-100 overflow-hidden"
                style={stripedStyle}
              >
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide relative">
                  {section.label}
                </h4>
              </div>
              <div className="divide-y divide-gray-100">
                {sp.map(renderRow)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-100">
          {products.map(renderRow)}
        </div>
      )}
    </div>
  )
}
