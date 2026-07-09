"use client"

import { Check, ChevronDown, Ticket } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import AddAttendeeButtons from "@/components/checkout-flow/shared/AddAttendeeButtons"
import ExpandableDescription from "@/components/ui/ExpandableDescription"
import QuantitySelector, {
  resolveBlockedStepperProps,
  resolveMaxQuantity,
  supportsQuantitySelector,
} from "@/components/ui/QuantitySelector"
import type { TemplateSection } from "@/hooks/checkout/ticketSections"
import {
  buildSectionGroups,
  isSectionVisibleForApp,
  parseSections,
} from "@/hooks/checkout/ticketSections"
import {
  type TicketRowVM,
  type TicketSectionVM,
  useTicketsStep,
} from "@/hooks/checkout/useTicketsStep"
import { useAttendeeCategories } from "@/hooks/useAttendeeCategories"
import { deriveProductState } from "@/lib/product-state"
import { cn } from "@/lib/utils"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { usePassesProvider } from "@/providers/passesProvider"
import { isPassQuantityBased } from "@/strategies/passQuantityHelper"
import type { AttendeePassState } from "@/types/Attendee"
import { formatCurrency, formatPrice } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"
import type { VariantProps } from "../registries/variantRegistry"
import { SaleStateBadge } from "./saleStateBadge"

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

const SELECTED_ROW_CLASSES = "bg-primary/10 border-l-primary"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortedAttendees(
  attendees: AttendeePassState[],
  categorySortOrderById: Map<string, number>,
): AttendeePassState[] {
  // Sort by the category's `sort_order` (configured per popup in backoffice).
  // Main remains first because admins seed it with sort_order=0 and it can't
  // be changed via the UI. Attendees without category_id fall to the end.
  const SENTINEL = Number.MAX_SAFE_INTEGER
  return [...attendees].sort((a, b) => {
    const aOrder = a.category_id
      ? (categorySortOrderById.get(a.category_id) ?? SENTINEL)
      : SENTINEL
    const bOrder = b.category_id
      ? (categorySortOrderById.get(b.category_id) ?? SENTINEL)
      : SENTINEL
    if (aOrder !== bOrder) return aOrder - bOrder
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
  templateConfig,
}: VariantProps) {
  const passesVariant: TicketSelectVariant =
    (templateConfig?.variant as TicketSelectVariant) || "stacked"

  // Contract hook — owns all business logic: selection, exclusivity, credit,
  // section-visibility, purchased state. Skins are pure presentation.
  const view = useTicketsStep({ stepType, templateConfig, products })

  // Raw attendee list from passesProvider — still needed for the layout
  // filtering logic (visibleAttendees/sortedAttendees) which operates on
  // AttendeePassState until Slice 2 migrates layouts to TicketAttendeeVM.
  const { attendeePasses } = usePassesProvider()

  const [focusedAttendeeId, setFocusedAttendeeId] = useState<string | null>(
    null,
  )

  // Apply per-application visibility (visible_if) once: it depends on the
  // application's form answers, not on individual attendees. Layouts and
  // helpers downstream consume the already-filtered list.
  const { getRelevantApplication } = useApplication()
  const customFields = getRelevantApplication()?.custom_fields ?? null
  const sections = parseSections(templateConfig).filter((s) =>
    isSectionVisibleForApp(s, customFields),
  )

  // Build category_id -> sort_order map for attendee ordering.
  const { getCity } = useCityProvider()
  const cityForSort = getCity()
  const popupIdForSort = cityForSort?.id ? String(cityForSort.id) : ""
  const { categories: categoriesForSort } =
    useAttendeeCategories(popupIdForSort)
  const categorySortOrderById = new Map<string, number>()
  for (const c of categoriesForSort ?? []) {
    categorySortOrderById.set(c.id, c.sort_order ?? 0)
  }

  // Explicit open-checkout path: simple_quantity mode with no real attendees.
  // The contract exposes view.isOpenCheckout=true and view.sections populated.
  if (view.isOpenCheckout) {
    return (
      <OpenCheckoutSectionLayout
        sections={view.sections}
        onQuantityChange={view.setRowQuantity}
      />
    )
  }

  // Filter attendees with no renderable content before dispatching to layouts.
  // This covers all four layout variants in one place (DRY per design ADR-6).
  const visibleAttendees = sortedAttendees(
    attendeePasses,
    categorySortOrderById,
  ).filter((a) => attendeeHasRenderableContent(a, sections))

  // Route toggle actions through the contract. The contract resolves
  // exclusivity scope, attendee-visible product ids, and strategies
  // internally — no business logic in the skin.
  const contractToggleProduct = (
    attendeeId: string,
    product: ProductsPass,
    _exclusivityScopeIds?: string[],
    _attendeeVisibleProductIds?: string[],
  ) => {
    // Scope args are ignored here because useTicketsStep.toggleRow derives
    // them from parsedSections internally.
    view.toggleRow(attendeeId, product)
  }

  const sharedProps = {
    attendees: visibleAttendees,
    toggleProduct: contractToggleProduct,
    isEditing: view.isEditing,
    sections,
    focusedAttendeeId,
  }

  const handleAttendeeAdded = (attendeeId: string) => {
    setFocusedAttendeeId(attendeeId)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <AddAttendeeButtons onAttendeeAdded={handleAttendeeAdded} />
      </div>
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
  toggleProduct: (
    attendeeId: string,
    product: ProductsPass,
    exclusivityScopeIds?: string[],
  ) => void
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
// parseSections, buildSectionGroups, and isSectionVisibleForApp are imported
// from @/hooks/checkout/ticketSections (the shared module).

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
  toggleProduct: (
    id: string,
    p: ProductsPass,
    exclusivityScopeIds?: string[],
    attendeeVisibleProductIds?: string[],
  ) => void
  isEditing: boolean
  sections: TemplateSection[]
}) {
  const { t } = useTranslation()
  const groups = buildSectionGroups(attendee, sections)

  // Wide scope passed to the strategy: every product id visible to this
  // attendee across ALL rendered sections. Enables cross-section auto-promote
  // (Week → Month) while keeping the cart honest about what the user can see.
  const attendeeVisibleProductIds = groups.flatMap((g) =>
    g.products.map((p) => p.id),
  )

  const hasFullOrMonthSelected = attendee.products.some(
    (p) =>
      (p.duration_type === "full" || p.duration_type === "month") &&
      (p.purchased || p.selected),
  )

  if (groups.length === 0) {
    return (
      <div className="px-5 py-8 text-center text-sm text-muted-foreground">
        {t("checkout.no_passes")}
      </div>
    )
  }

  return (
    <>
      {groups.map(({ section, products: sectionProducts }) => {
        const scopeIds = sectionProducts.map((sp) => sp.id)
        return (
          <PassSection key={section.key} label={section.label}>
            {sectionProducts.map((p) =>
              p.duration_type === "day" ? (
                <DayPassRow
                  key={p.id}
                  product={p}
                  onQuantityChange={(qty) =>
                    toggleProduct(
                      attendee.id,
                      { ...p, quantity: qty },
                      scopeIds,
                      attendeeVisibleProductIds,
                    )
                  }
                  disabled={hasFullOrMonthSelected}
                  isEditing={isEditing}
                />
              ) : (
                <PassRow
                  key={p.id}
                  product={p}
                  onClick={() =>
                    toggleProduct(
                      attendee.id,
                      p,
                      scopeIds,
                      attendeeVisibleProductIds,
                    )
                  }
                  onQuantityChange={(qty) =>
                    toggleProduct(
                      attendee.id,
                      { ...p, quantity: qty },
                      scopeIds,
                      attendeeVisibleProductIds,
                    )
                  }
                  disabled={
                    p.duration_type === "week" && hasFullOrMonthSelected
                  }
                  isEditing={isEditing}
                />
              ),
            )}
          </PassSection>
        )
      })}
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
  const { t } = useTranslation()
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
  const descriptionRef = useRef<HTMLParagraphElement>(null)
  const [isDescriptionOverflowing, setIsDescriptionOverflowing] =
    useState(false)
  // Multi-unit stepper mode — editing of purchased multi-unit passes is out
  // of scope (plan decision), so we only show the stepper for non-purchased rows.
  // Full/month passes are always single-select in pass_system (use isPassQuantityBased
  // so a full pass with max_per_order=null does not render as a stepper).
  const showStepper =
    !!onQuantityChange && isPassQuantityBased(product) && !purchased
  const currentQuantity = product.quantity ?? 0
  const maxQuantity = resolveMaxQuantity(product)

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure on description and collapse state changes
  useLayoutEffect(() => {
    if (summaryOpen) return
    const el = descriptionRef.current
    if (!el) return
    setIsDescriptionOverflowing(el.scrollWidth > el.clientWidth + 1)
  }, [product.description, summaryOpen])

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return
    if (summaryOpen) return
    const el = descriptionRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const node = descriptionRef.current
      if (!node) return
      setIsDescriptionOverflowing(node.scrollWidth > node.clientWidth + 1)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [summaryOpen])

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
            ? SELECTED_ROW_CLASSES
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
          {product.description && (
            <p
              ref={descriptionRef}
              className="text-xs text-muted-foreground truncate mt-0.5"
            >
              {product.description}
            </p>
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
            "text-foreground",
            rowIsActive ? "font-bold" : "font-semibold",
          )}
        >
          {formatPrice(product.price, t("common.free"))}
        </p>
      </div>
    </button>
  )

  const hasDescription = !!product.description
  const showExpandControls =
    hasDescription && (summaryOpen || isDescriptionOverflowing)

  if (showExpandControls) {
    return (
      <div>
        {mainButton}
        <div className="px-5 pb-2 pt-0">
          {summaryOpen ? (
            <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
              {product.description}{" "}
              <button
                type="button"
                onClick={() => setSummaryOpen(false)}
                className="inline-flex items-center gap-0.5 font-medium text-primary underline underline-offset-2 hover:opacity-80 align-baseline"
              >
                {t("common.see_less")}
                <ChevronDown className="w-3 h-3 rotate-180" />
              </button>
            </p>
          ) : (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setSummaryOpen(true)}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-primary underline underline-offset-2 hover:opacity-80"
              >
                {t("common.see_more")}
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
  const { t } = useTranslation()
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
            ? SELECTED_ROW_CLASSES
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
          {formatPrice(product.price, t("common.free"))}
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
  toggleProduct: (
    id: string,
    p: ProductsPass,
    exclusivityScopeIds?: string[],
    attendeeVisibleProductIds?: string[],
  ) => void
  isEditing: boolean
  sections: TemplateSection[]
}) {
  const { t } = useTranslation()
  const meta = getCategoryMeta(attendee.category ?? "")
  const groups = buildSectionGroups(attendee, sections)
  const visibleProducts = groups.flatMap((g) => g.products)
  const attendeeVisibleProductIds = visibleProducts.map((p) => p.id)
  // Lookup: product.id → ids of peers in the same section, for exclusivity scope.
  const scopeIdsByProductId = new Map<string, string[]>()
  for (const g of groups) {
    const ids = g.products.map((p) => p.id)
    for (const p of g.products) scopeIdsByProductId.set(p.id, ids)
  }

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
        <p className="text-xs text-muted-foreground">
          {t("checkout.no_passes")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {visibleProducts.map((p) => {
            const isDayPass = p.duration_type === "day"
            const hasStepper = isPassQuantityBased(p)
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
              // Purchased outside edit mode is the only fully frozen case;
              // every other reason still allows removing cart quantity.
              const tileLocked = p.purchased && !isEditing
              const tileBlocked =
                !!p.disabled ||
                pillStateBlocked ||
                (!isDayPass &&
                  isChild &&
                  (p.duration_type === "full" ||
                    p.duration_type === "month")) ||
                (p.duration_type === "week" && hasFullOrMonthSelected) ||
                (p.duration_type === "day" && hasFullOrMonthSelected)
              const tileDisabled = tileBlocked || tileLocked
              // Blocked rows stay removable: cap max at the cart quantity so
              // increment self-disables while decrement keeps working.
              const stepper = resolveBlockedStepperProps({
                blocked: tileBlocked,
                locked: tileLocked,
                quantity: qty,
                max,
              })

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
                    max={stepper.max}
                    disabled={stepper.disabled}
                    onIncrement={() =>
                      toggleProduct(
                        attendee.id,
                        { ...p, quantity: qty + 1 },
                        scopeIdsByProductId.get(p.id),
                        attendeeVisibleProductIds,
                      )
                    }
                    onDecrement={() =>
                      toggleProduct(
                        attendee.id,
                        { ...p, quantity: qty - 1 },
                        scopeIdsByProductId.get(p.id),
                        attendeeVisibleProductIds,
                      )
                    }
                    onAdd={() =>
                      toggleProduct(
                        attendee.id,
                        { ...p, quantity: 1 },
                        scopeIdsByProductId.get(p.id),
                        attendeeVisibleProductIds,
                      )
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
                    {formatPrice(p.price, t("common.free"))}
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
                  isDisabled
                    ? undefined
                    : () =>
                        toggleProduct(
                          attendee.id,
                          p,
                          scopeIdsByProductId.get(p.id),
                          attendeeVisibleProductIds,
                        )
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
                  {formatPrice(p.price, t("common.free"))}
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
// Open-checkout section layout (explicit simple_quantity / no-attendee path)
// ---------------------------------------------------------------------------

/**
 * Renders a flat list of sections from the contract's view.sections.
 * Replaces the former LegacySectionLayout which read from dynamicItems directly.
 * State (quantity, selected) is precomputed in the TicketRowVM by useTicketsStep.
 */
function OpenCheckoutRow({
  row,
  onQuantityChange,
}: {
  row: TicketRowVM
  onQuantityChange: (
    attendeeId: string,
    product: ProductsPass,
    qty: number,
  ) => void
}) {
  const { t } = useTranslation()
  const { product, quantity, maxQuantity, selected, disabled } = row
  const isAdded = quantity > 0 || selected
  const hasDiscount =
    product.compare_price != null && product.compare_price > product.price
  const total = product.price * (quantity > 0 ? quantity : 1)

  return (
    <div
      className={cn("p-4 transition-colors", isAdded ? "bg-primary/10" : "")}
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-foreground text-sm">
              {product.name}
            </h3>
          </div>
          {product.description && (
            <ExpandableDescription
              text={product.description}
              clamp={2}
              className="text-xs text-muted-foreground mt-0.5"
            />
          )}
        </div>
        {/* Single add affordance for every row: the stepper degrades
            gracefully for max_per_order = 1 products (the "+" disables at
            the cap, "−" removes), so no separate Add/Added toggle needed. */}
        <QuantitySelector
          size="md"
          value={quantity}
          min={0}
          max={maxQuantity}
          disabled={disabled}
          onIncrement={() => onQuantityChange("", product, quantity + 1)}
          onDecrement={() =>
            onQuantityChange("", product, Math.max(0, quantity - 1))
          }
          onAdd={() => onQuantityChange("", product, 1)}
        />
        <div className="text-right shrink-0 min-w-16">
          {/* The compare price is a per-unit anchor, so it must sit next to
              the unit price. Stacking it against the line total reads as if
              it were the pre-discount total. */}
          {isAdded && quantity > 1 ? (
            <p className="text-xs text-muted-foreground">
              {quantity} ×{" "}
              {hasDiscount && product.compare_price != null && (
                <span className="line-through">
                  {formatCurrency(product.compare_price)}
                </span>
              )}{" "}
              {formatCurrency(product.price)}
            </p>
          ) : (
            hasDiscount &&
            product.compare_price != null && (
              <p className="text-xs text-muted-foreground line-through">
                {formatCurrency(product.compare_price)}
              </p>
            )
          )}
          <span
            className={cn(
              "font-semibold text-sm",
              isAdded ? "text-primary" : "text-foreground",
            )}
          >
            {formatPrice(total, t("common.free"))}
          </span>
        </div>
      </div>
    </div>
  )
}

function OpenCheckoutSectionLayout({
  sections,
  onQuantityChange,
}: {
  sections: TicketSectionVM[]
  onQuantityChange: (
    attendeeId: string,
    product: ProductsPass,
    qty: number,
  ) => void
}) {
  const showHeaders = sections.length > 1

  return (
    <div className="space-y-4">
      {sections.map(({ key, label, rows }) => (
        <div
          key={key}
          className="bg-checkout-card-bg rounded-2xl shadow-sm border border-border overflow-hidden divide-y divide-border"
        >
          {showHeaders && (
            <div className="px-5 py-2 bg-muted/30">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {label}
              </h4>
            </div>
          )}
          {rows.map((row) => (
            <OpenCheckoutRow
              key={row.product.id}
              row={row}
              onQuantityChange={onQuantityChange}
            />
          ))}
        </div>
      ))}
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
