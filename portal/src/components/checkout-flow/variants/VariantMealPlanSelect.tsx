"use client"

/**
 * Meal-plan checkout step — grid layout.
 *
 * Rows = attendees, columns = weekly meal-plan products (typically 4 weeks).
 * Each (attendee, week) cell is the unit of toggling and per-day meal-picking.
 * Selecting an unsold week adds a cart line; clicking a selected (or empty-but-
 * active) cell expands an inline editor below the row where the buyer assigns a
 * dish to each weekday using tap buttons (no dropdowns).
 *
 * Cells the attendee already purchased outside this flow render as
 * "✓ Purchased" — visually locked, not clickable, and rejected by the provider
 * reducer as defense in depth.
 *
 * Ported from `MealPlanGrid.tsx` (approved prototype). State now lives in the
 * checkout provider's meal-plan slice instead of a local useReducer; data
 * (attendees, products, template_config) comes from props + providers.
 *
 * The pure planner pieces (parsing/format helpers, DishButton, DayEmojiStrip,
 * DayPlanEditor) live in `mealPlanShared.tsx` so the post-purchase edit modal
 * can reuse them without the checkout provider.
 */

import { Sparkles } from "lucide-react"
import { Fragment, useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import { usePassesProvider } from "@/providers/passesProvider"
import type { AttendeePassState } from "@/types/Attendee"
import { formatCurrency, type SelectedMealPlanItem } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"
import type { VariantProps } from "../registries/variantRegistry"
import {
  DayEmojiStrip,
  DayPlanEditor,
  formatCoverageRange,
  parseMealPlanTemplateConfig,
  type MealPlanProduct as SharedMealPlanProduct,
  weekdayDates,
} from "./mealPlanShared"

/** Weekly meal-plan product enriched with template_config metadata, with the
 *  product field narrowed to ProductsPass for this checkout step. */
type MealPlanProduct = SharedMealPlanProduct<ProductsPass>

/** Identifies which (attendee, product) cell is expanded for editing. */
type OpenCell = { attendeeId: string; productId: string } | null

// ---------------------------------------------------------------------------
// Cart selectors (operate on SelectedMealPlanItem[] from provider)
// ---------------------------------------------------------------------------

function cartItem(
  state: SelectedMealPlanItem[],
  attendeeId: string,
  productId: string,
): SelectedMealPlanItem | undefined {
  return state.find(
    (i) => i.attendeeId === attendeeId && i.productId === productId,
  )
}

function selectedProductIdsFor(
  state: SelectedMealPlanItem[],
  attendeeId: string,
): Set<string> {
  return new Set(
    state.filter((i) => i.attendeeId === attendeeId).map((i) => i.productId),
  )
}

function filledDayCount(
  item: SelectedMealPlanItem | undefined,
  product: MealPlanProduct,
): number {
  if (!item?.dailyChoices) return 0
  const dates = weekdayDates(product)
  return dates.filter((d) => item.dailyChoices?.[d]).length
}

function isWeekFullyPlanned(
  item: SelectedMealPlanItem | undefined,
  product: MealPlanProduct,
): boolean {
  return filledDayCount(item, product) === weekdayDates(product).length
}

// ---------------------------------------------------------------------------
// Pre-purchased detection
// ---------------------------------------------------------------------------

/** True when the attendee already has a purchased AttendeeProducts row for
 *  this meal-plan product. Mirrors VariantTicketSelect's `product.purchased`
 *  read — the passes provider sets it for any product the attendee owns. */
function isPrePurchased(
  attendee: AttendeePassState,
  productId: string,
): boolean {
  return attendee.products.some((p) => p.id === productId && !!p.purchased)
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function VariantMealPlanSelect({
  products,
  templateConfig,
}: VariantProps) {
  const { attendeePasses } = usePassesProvider()
  const {
    cart,
    addMealPlan,
    removeMealPlan,
    setMealPlanDailyChoice,
    setMealPlanDietaryRestriction,
    setMealPlanSpecialRequest,
  } = useCheckout()

  // Filter to meal-plan products only (the registry passes the step-resolved
  // product list; we still defensively filter so a misconfigured step can't
  // render a non-meal-plan product as a column).
  const mealPlanProducts = useMemo(
    () => products.filter((p) => p.category === "meal_plan"),
    [products],
  )

  const { sections } = useMemo(
    () => parseMealPlanTemplateConfig(templateConfig, mealPlanProducts),
    [templateConfig, mealPlanProducts],
  )

  const [openCell, setOpenCell] = useState<OpenCell>(null)

  // Flatten sections into a single weekly product list for the grid columns.
  // Today the grid always renders one section ("weekly"); the flatten keeps
  // us forward-compatible with a multi-section spec without complicating the
  // visual layout.
  const weeklyProducts = useMemo(
    () => sections.flatMap((s) => s.products),
    [sections],
  )

  const sectionInfoHtml = sections[0]?.description ?? null

  const openIs = (attendeeId: string, productId: string) =>
    openCell?.attendeeId === attendeeId && openCell?.productId === productId

  const handleCellClick = (
    attendee: AttendeePassState,
    product: MealPlanProduct,
  ) => {
    if (isPrePurchased(attendee, product.id)) return
    const selected = selectedProductIdsFor(cart.mealPlans, attendee.id).has(
      product.id,
    )
    if (!selected) {
      addMealPlan(
        attendee.id,
        product.id,
        weekdayDates(product),
        product.menuOptions[0]?.key,
      )
      setOpenCell({ attendeeId: attendee.id, productId: product.id })
      return
    }
    // Already in cart — toggle the editor open/close.
    if (openIs(attendee.id, product.id)) {
      setOpenCell(null)
    } else {
      setOpenCell({ attendeeId: attendee.id, productId: product.id })
    }
  }

  if (mealPlanProducts.length === 0 || weeklyProducts.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        No meal plans available.
      </div>
    )
  }

  if (attendeePasses.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        Add at least one attendee to choose meal plans.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {sectionInfoHtml && (
        <div
          className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-foreground [&_p]:m-0 [&_strong]:font-semibold"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: operator-configured rich-text — sanitized server-side
          dangerouslySetInnerHTML={{ __html: sectionInfoHtml }}
        />
      )}

      <div
        className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden"
        data-testid="meal-plan-grid"
      >
        {/* Header row — visible on md+ only. On mobile each week cell carries
            its own week label, since cells stack vertically per attendee. */}
        <div
          className="hidden md:grid border-b border-border bg-muted/40"
          style={{
            gridTemplateColumns: `minmax(140px,1.2fr) repeat(${weeklyProducts.length},minmax(0,1fr))`,
          }}
        >
          <div className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Attendee
          </div>
          {weeklyProducts.map((p) => (
            <div
              key={p.id}
              className="px-2 py-2.5 text-center border-l border-border"
            >
              <div className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wide">
                {p.weekLabel}
              </div>
              <div className="text-[11px] text-foreground font-medium mt-0.5">
                {formatCoverageRange(p)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {formatCurrency(p.product.price)} / wk
              </div>
            </div>
          ))}
        </div>

        {/* Body rows — one (attendee row) + optional (open editor row) per attendee */}
        {attendeePasses.map((attendee) => (
          <AttendeeRow
            key={attendee.id}
            attendee={attendee}
            weeklyProducts={weeklyProducts}
            mealPlans={cart.mealPlans}
            openCell={openCell}
            onCellClick={handleCellClick}
            onCloseEditor={() => setOpenCell(null)}
            removeMealPlan={removeMealPlan}
            setMealPlanDailyChoice={setMealPlanDailyChoice}
            setMealPlanDietaryRestriction={setMealPlanDietaryRestriction}
            setMealPlanSpecialRequest={setMealPlanSpecialRequest}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground italic px-1">
        Tap a week to add it. Tap again to plan each day's lunch.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-attendee row
// ---------------------------------------------------------------------------

interface AttendeeRowProps {
  attendee: AttendeePassState
  weeklyProducts: MealPlanProduct[]
  mealPlans: SelectedMealPlanItem[]
  openCell: OpenCell
  onCellClick: (a: AttendeePassState, p: MealPlanProduct) => void
  onCloseEditor: () => void
  removeMealPlan: (attendeeId: string, productId: string) => void
  setMealPlanDailyChoice: (
    attendeeId: string,
    productId: string,
    date: string,
    menuKey: string,
  ) => void
  setMealPlanDietaryRestriction: (attendeeId: string, value: string) => void
  setMealPlanSpecialRequest: (attendeeId: string, value: string) => void
}

function AttendeeRow({
  attendee,
  weeklyProducts,
  mealPlans,
  openCell,
  onCellClick,
  onCloseEditor,
  removeMealPlan,
  setMealPlanDailyChoice,
  setMealPlanDietaryRestriction,
  setMealPlanSpecialRequest,
}: AttendeeRowProps) {
  const selectedHere = selectedProductIdsFor(mealPlans, attendee.id)
  const isOpenForThisAttendee = openCell?.attendeeId === attendee.id
  const openProduct = isOpenForThisAttendee
    ? weeklyProducts.find((p) => p.id === openCell.productId)
    : null

  // Row total = priced selections only (excludes already-purchased weeks since
  // those aren't part of this checkout).
  const total = Array.from(selectedHere).reduce((sum, pid) => {
    const p = weeklyProducts.find((x) => x.id === pid)
    return sum + (p?.product.price ?? 0)
  }, 0)

  // Pick the first cart item for this attendee — dietary + special are synced
  // across all of their cart items by the reducer, so any one reads the value.
  const anyItem = mealPlans.find((i) => i.attendeeId === attendee.id)
  const hasSelections = !!anyItem

  const ageBracket = attendee.category ?? ""

  return (
    <div className="border-b border-border last:border-b-0">
      <div
        className="flex flex-col md:grid md:items-stretch"
        style={{
          gridTemplateColumns: `minmax(140px,1.2fr) repeat(${weeklyProducts.length},minmax(0,1fr))`,
        }}
      >
        {/* Attendee identity cell — non-clickable, just the row label. */}
        <div className="flex items-center gap-2.5 px-3 py-2.5 bg-muted/20 md:bg-muted/10 border-b border-border md:border-b-0">
          <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-bold shrink-0">
            {(attendee.name ?? "?").charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-foreground leading-tight truncate">
              {attendee.name}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {ageBracket && (
                <span className="text-[10px] text-muted-foreground capitalize">
                  {ageBracket}
                </span>
              )}
              {total > 0 && (
                <span className="text-[10px] font-semibold text-foreground">
                  · {formatCurrency(total)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Mobile-only per-attendee meta section. md:hidden makes it skip the
            desktop grid; the desktop equivalent renders below the grid row. */}
        {hasSelections && anyItem && (
          <div className="md:hidden border-b border-border bg-muted/15 px-3 py-2.5">
            <AttendeeMetaSection
              attendee={attendee}
              item={anyItem}
              setMealPlanDietaryRestriction={setMealPlanDietaryRestriction}
              setMealPlanSpecialRequest={setMealPlanSpecialRequest}
            />
          </div>
        )}

        {weeklyProducts.map((product) => {
          const isPicked = selectedHere.has(product.id)
          const isLocked = isPrePurchased(attendee, product.id)
          const isOpen =
            openCell?.attendeeId === attendee.id &&
            openCell?.productId === product.id
          const item = cartItem(mealPlans, attendee.id, product.id)
          // When the cell is fully planned on mobile, paint the green gradient
          // on the whole wrapper (including the mobile header above the cell)
          // so the week reads as one solid green tile.
          const fullGreen =
            isPicked && !!item && isWeekFullyPlanned(item, product)
          return (
            <Fragment key={product.id}>
              <div
                className={cn(
                  "border-t border-border md:border-t-0 md:border-l",
                  fullGreen &&
                    "bg-gradient-to-br from-emerald-50 via-green-50 to-emerald-50 md:bg-transparent md:bg-none",
                )}
              >
                {/* Mobile-only week header only shows for SELECTED weeks (where
                    the cell renders the green tile + emoji strip and needs a
                    label above for context). Unselected/locked cells inline
                    the week+date+price into their own single row. */}
                {isPicked && (
                  <div
                    className={cn(
                      "md:hidden px-3 pt-1.5 pb-0.5 flex items-baseline gap-1.5",
                      fullGreen ? "bg-transparent" : "bg-muted/15",
                    )}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      {product.weekLabel}
                    </span>
                    <span className="text-[10px] text-foreground font-medium">
                      {formatCoverageRange(product)}
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {formatCurrency(product.product.price)}/wk
                    </span>
                  </div>
                )}
                <WeekCell
                  attendee={attendee}
                  product={product}
                  isPicked={isPicked}
                  isLocked={isLocked}
                  isOpen={isOpen}
                  item={item}
                  onClick={() => onCellClick(attendee, product)}
                />
              </div>
              {/* Mobile-only inline editor — renders right under the opened
                  cell so the buyer doesn't lose context after tapping.
                  Hidden on desktop where the editor renders below the grid. */}
              {isOpen && (
                <div className="md:hidden border-t border-border bg-muted/30 px-3 py-3 animate-in fade-in slide-in-from-top-2 duration-200">
                  <DayPlanEditor
                    product={product}
                    dailyChoices={
                      cartItem(mealPlans, attendee.id, product.id)?.dailyChoices
                    }
                    onSetDay={(d, key) =>
                      setMealPlanDailyChoice(attendee.id, product.id, d, key)
                    }
                    eyebrow={`Planning lunches for ${attendee.name}`}
                    onClose={onCloseEditor}
                    onRemove={() => removeMealPlan(attendee.id, product.id)}
                  />
                </div>
              )}
            </Fragment>
          )
        })}
      </div>

      {/* Desktop-only per-attendee meta section — between grid row and editor. */}
      {hasSelections && anyItem && (
        <div className="hidden md:block border-t border-border bg-muted/15 px-4 py-3">
          <AttendeeMetaSection
            attendee={attendee}
            item={anyItem}
            setMealPlanDietaryRestriction={setMealPlanDietaryRestriction}
            setMealPlanSpecialRequest={setMealPlanSpecialRequest}
          />
        </div>
      )}

      {/* Desktop-only editor — full-width below the grid row. Hidden on
          mobile (mobile renders an inline editor per cell instead). */}
      {isOpenForThisAttendee && openProduct && (
        <div className="hidden md:block border-t border-border bg-muted/30 px-4 py-4 sm:px-6 sm:py-5 animate-in fade-in slide-in-from-top-2 duration-200">
          <DayPlanEditor
            product={openProduct}
            dailyChoices={
              cartItem(mealPlans, attendee.id, openProduct.id)?.dailyChoices
            }
            onSetDay={(d, key) =>
              setMealPlanDailyChoice(attendee.id, openProduct.id, d, key)
            }
            eyebrow={`Planning lunches for ${attendee.name}`}
            onClose={onCloseEditor}
            onRemove={() => removeMealPlan(attendee.id, openProduct.id)}
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-attendee meta section (dietary restrictions + special request)
// ---------------------------------------------------------------------------

function AttendeeMetaSection({
  attendee,
  item,
  setMealPlanDietaryRestriction,
  setMealPlanSpecialRequest,
}: {
  attendee: AttendeePassState
  item: SelectedMealPlanItem
  setMealPlanDietaryRestriction: (attendeeId: string, value: string) => void
  setMealPlanSpecialRequest: (attendeeId: string, value: string) => void
}) {
  return (
    <div className="space-y-2.5 md:space-y-0 md:grid md:grid-cols-2 md:gap-3 md:items-start">
      <div className="space-y-1">
        <Label
          htmlFor={`${attendee.id}-mp-restriction`}
          className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {attendee.name}'s dietary restriction & allergies
        </Label>
        <Input
          id={`${attendee.id}-mp-restriction`}
          value={item.dietaryRestriction ?? ""}
          placeholder="e.g. peanut allergy, gluten-free"
          onChange={(e) =>
            setMealPlanDietaryRestriction(attendee.id, e.target.value)
          }
        />
      </div>
      <div className="space-y-1">
        <Label
          htmlFor={`${attendee.id}-mp-special`}
          className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Special request for {attendee.name}
        </Label>
        <Input
          id={`${attendee.id}-mp-special`}
          value={item.specialRequest ?? ""}
          placeholder="Anything else for our chef?"
          onChange={(e) =>
            setMealPlanSpecialRequest(attendee.id, e.target.value)
          }
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Single grid cell
// ---------------------------------------------------------------------------

function WeekCell({
  attendee,
  product,
  isPicked,
  isLocked,
  isOpen,
  item,
  onClick,
}: {
  attendee: AttendeePassState
  product: MealPlanProduct
  isPicked: boolean
  isLocked: boolean
  isOpen: boolean
  item: SelectedMealPlanItem | undefined
  onClick: () => void
}) {
  if (isLocked) {
    return (
      <div
        role="img"
        aria-label={`${attendee.name} already purchased ${product.weekLabel}`}
        aria-disabled="true"
        className="h-full flex items-center justify-between md:justify-center gap-2 md:gap-1.5 md:min-h-[60px] min-h-[44px] bg-muted/40 px-3 md:px-2 py-1.5 select-none opacity-70"
        title={`${attendee.name} already purchased this meal plan.`}
      >
        {/* Mobile-only week info on the left */}
        <div className="md:hidden flex flex-col items-start leading-tight min-w-0">
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {product.weekLabel}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {formatCoverageRange(product)}
          </span>
        </div>
        {/* Center: ✓ Purchased badge */}
        <div className="flex items-center gap-1.5">
          <span aria-hidden="true" className="text-sm leading-none">
            ✓
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Purchased
          </span>
        </div>
        {/* Mobile-only price on the right */}
        <span className="md:hidden text-[10px] text-muted-foreground shrink-0">
          {formatCurrency(product.product.price)}/wk
        </span>
      </div>
    )
  }

  if (!isPicked) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group relative h-full w-full flex items-center justify-between md:justify-center gap-2 md:gap-1.5 md:min-h-[60px] min-h-[44px] bg-card cursor-pointer transition-colors px-3 md:px-2 py-1.5",
          "hover:bg-primary/10 hover:ring-2 hover:ring-primary/40 hover:ring-inset",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-inset",
        )}
      >
        {/* Mobile-only week info on the left */}
        <div className="md:hidden flex flex-col items-start leading-tight min-w-0">
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {product.weekLabel}
          </span>
          <span className="text-[10px] text-foreground font-medium">
            {formatCoverageRange(product)}
          </span>
        </div>
        {/* Center: + Add */}
        <div className="flex items-center gap-1.5 md:gap-1.5">
          <span className="text-primary/70 md:text-muted-foreground/60 text-xl md:text-lg font-light leading-none transition-all group-hover:scale-110 group-hover:text-primary">
            +
          </span>
          <span className="text-[11px] md:text-[10px] font-semibold uppercase tracking-wide text-primary/80 md:text-muted-foreground/70 group-hover:text-primary transition-colors">
            Add
          </span>
        </div>
        {/* Mobile-only price on the right */}
        <span className="md:hidden text-[10px] text-muted-foreground shrink-0">
          {formatCurrency(product.product.price)}/wk
        </span>
        <span className="sr-only">Add {product.weekLabel}</span>
      </button>
    )
  }

  // Selected — render the cheerful per-day emoji strip + state caption.
  const dates = weekdayDates(product)
  const filled = filledDayCount(item, product)
  const allSet = isWeekFullyPlanned(item, product)

  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={isOpen}
      className={cn(
        "group h-full w-full flex flex-col items-center justify-center gap-1 md:min-h-[72px] min-h-[56px] px-2 py-1.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset",
        allSet
          ? "bg-gradient-to-br from-emerald-50 via-green-50 to-emerald-50 hover:from-emerald-100 hover:via-green-100 hover:to-emerald-100"
          : "bg-primary/5 hover:bg-primary/10",
        // Open-state ring is desktop-only — on mobile the editor renders
        // inline immediately under the cell, so the ring adds no clarity.
        isOpen && "md:ring-2 md:ring-primary/40 md:ring-inset",
      )}
    >
      <DayEmojiStrip
        product={product}
        dailyChoices={item?.dailyChoices ?? null}
      />
      <div className="flex items-center gap-1.5 leading-tight">
        {allSet ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700">
            <Sparkles className="w-3 h-3" />
            Yum! All set
          </span>
        ) : filled === 0 ? (
          <span className="text-[10px] font-medium text-muted-foreground">
            Tap to plan {dates.length} days
          </span>
        ) : (
          <span className="text-[10px] font-medium text-foreground">
            {filled}/{dates.length} days
          </span>
        )}
      </div>
    </button>
  )
}
