"use client"

/**
 * Shared, prop-driven meal-plan building blocks.
 *
 * Extracted from `VariantMealPlanSelect.tsx` so both the checkout step (cart-
 * backed) and the post-purchase edit modal (purchase_metadata-backed) render
 * the same per-day planner without coupling to the checkout provider.
 *
 * Everything here is pure: parsing helpers, date/format helpers, and the
 * presentational `DishButton` / `DayEmojiStrip` / `DayPlanEditor` components.
 * State ownership stays with the caller — `DayPlanEditor` reads a
 * `dailyChoices` map and emits `onSetDay(date, menuKey)`.
 */

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types — view-model derived from templateConfig + products
// ---------------------------------------------------------------------------

export interface MenuOption {
  key: string
  icon: string
  title: string
  description: string
  tags: string[]
}

/** A weekly meal-plan product enriched with its template_config metadata.
 *  `product` is intentionally typed generically here (id + name) so this module
 *  stays decoupled from ProductsPass; callers build it via
 *  parseMealPlanTemplateConfig with their own product list. */
export interface MealPlanProduct<TProduct = MealPlanProductRef> {
  id: string
  product: TProduct
  weekLabel: string
  coverageStart: string
  coverageEnd: string
  menuOptions: MenuOption[]
}

export interface MealPlanProductRef {
  id: string
  name?: string | null
  price?: number
}

export interface MealPlanSection<TProduct = MealPlanProductRef> {
  key: string
  label: string
  order: number
  description: string | null
  products: MealPlanProduct<TProduct>[]
}

// ---------------------------------------------------------------------------
// templateConfig parsing
// ---------------------------------------------------------------------------

interface RawSection {
  key?: string
  label?: string
  order?: number
  description?: string | null
  products?: RawSectionProduct[]
}

interface RawSectionProduct {
  product_id?: string
  coverage_start?: string
  coverage_end?: string
  menu_options?: Array<{
    key?: string
    icon?: string | null
    title?: string
    description?: string | null
    tags?: string[]
  }>
}

export type MealPlanTemplateConfigInput =
  | Record<string, unknown>
  | null
  | undefined

/** Collect every product_id referenced by a meal-plan step's sections.
 *  Used to detect which purchased tickets are editable meal-plan weeks. */
export function mealPlanProductIds(
  templateConfig: MealPlanTemplateConfigInput,
): Set<string> {
  const rawSections = (templateConfig?.sections ?? []) as RawSection[]
  const ids = new Set<string>()
  for (const section of rawSections) {
    for (const sp of section.products ?? []) {
      if (sp.product_id) ids.add(sp.product_id)
    }
  }
  return ids
}

export function parseMealPlanTemplateConfig<
  TProduct extends MealPlanProductRef,
>(
  templateConfig: MealPlanTemplateConfigInput,
  products: TProduct[],
): { sections: MealPlanSection<TProduct>[] } {
  const productById = new Map(products.map((p) => [p.id, p]))

  const rawSections = (templateConfig?.sections ?? []) as RawSection[]

  const sections: MealPlanSection<TProduct>[] = [...rawSections]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((section, sIdx) => {
      const sectionProducts: MealPlanProduct<TProduct>[] = []
      const productsRaw = Array.isArray(section.products)
        ? section.products
        : []
      productsRaw.forEach((sp, pIdx) => {
        if (!sp.product_id) return
        const product = productById.get(sp.product_id)
        if (!product) return
        if (!sp.coverage_start || !sp.coverage_end) return
        const menuOptions: MenuOption[] = (sp.menu_options ?? []).map(
          (opt) => ({
            key: opt.key || "",
            icon: opt.icon || "🍽️",
            title: opt.title || "",
            description: opt.description || "",
            tags: Array.isArray(opt.tags) ? opt.tags : [],
          }),
        )
        sectionProducts.push({
          id: product.id,
          product,
          weekLabel: product.name || `Week ${pIdx + 1}`,
          coverageStart: sp.coverage_start,
          coverageEnd: sp.coverage_end,
          menuOptions,
        })
      })
      return {
        key: section.key || `section-${sIdx}`,
        label: section.label || "",
        order: section.order ?? sIdx,
        description: section.description ?? null,
        products: sectionProducts,
      }
    })

  return { sections }
}

// ---------------------------------------------------------------------------
// Date / formatting helpers
// ---------------------------------------------------------------------------

/** Returns Mon–Fri ISO dates for a product's coverage week (inclusive). */
export function weekdayDates(product: {
  coverageStart: string
  coverageEnd: string
}): string[] {
  const start = new Date(`${product.coverageStart}T00:00:00`)
  const end = new Date(`${product.coverageEnd}T00:00:00`)
  const out: string[] = []
  for (
    let d = new Date(start);
    d.getTime() <= end.getTime();
    d.setDate(d.getDate() + 1)
  ) {
    const day = d.getDay() // 0 Sun, 6 Sat
    if (day >= 1 && day <= 5) out.push(d.toISOString().slice(0, 10))
  }
  return out
}

const WEEKDAY_LABELS: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
}

export function formatWeekdayShort(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`)
  return WEEKDAY_LABELS[d.getDay()] ?? ""
}

export function formatDayNum(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`)
  return String(d.getDate())
}

export function formatCoverageRange(product: {
  coverageStart: string
  coverageEnd: string
}): string {
  const start = new Date(`${product.coverageStart}T00:00:00`)
  const end = new Date(`${product.coverageEnd}T00:00:00`)
  const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short" })
  const sameMonth = start.getMonth() === end.getMonth()
  if (sameMonth) {
    return `${monthFmt.format(start)} ${start.getDate()}–${end.getDate()}`
  }
  return `${monthFmt.format(start)} ${start.getDate()} – ${monthFmt.format(end)} ${end.getDate()}`
}

export function findMenuOption(
  product: { menuOptions: MenuOption[] },
  key: string,
): MenuOption | null {
  return product.menuOptions.find((o) => o.key === key) ?? null
}

// ---------------------------------------------------------------------------
// DayEmojiStrip — a row of Mon–Fri emoji slots filled with the chosen dish
// ---------------------------------------------------------------------------

export function DayEmojiStrip({
  product,
  dailyChoices,
}: {
  product: MealPlanProduct<MealPlanProductRef>
  dailyChoices: Record<string, string> | null
}) {
  const dates = weekdayDates(product)
  return (
    <div className="flex items-center justify-center gap-0.5">
      {dates.map((d) => {
        const pick = dailyChoices?.[d] ?? null
        const opt = pick ? findMenuOption(product, pick) : null
        return (
          <div
            key={d}
            className={cn(
              "w-5 h-5 rounded-md flex items-center justify-center text-[13px] leading-none shrink-0 overflow-hidden transition-all",
              opt
                ? "bg-white/80 shadow-sm"
                : "bg-muted-foreground/10 text-muted-foreground/40 text-[10px]",
            )}
            title={
              opt
                ? `${formatWeekdayShort(d)}: ${opt.title}`
                : `${formatWeekdayShort(d)}: not set`
            }
          >
            {opt ? opt.icon : "·"}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// DishButton — tappable per-day dish option
// ---------------------------------------------------------------------------

export function DishButton({
  option,
  isActive,
  onClick,
  disabled = false,
}: {
  option: MenuOption
  isActive: boolean
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-pressed={isActive}
      title={
        option.tags.length > 0
          ? `${option.title} — ${option.tags.join(", ")}. ${option.description}`
          : `${option.title}. ${option.description}`
      }
      className={cn(
        "group flex items-center md:gap-1.5 justify-center rounded-md border px-1.5 py-1.5 text-center md:text-left transition-all min-h-[44px]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        isActive
          ? "border-primary bg-primary/10 shadow-sm"
          : "border-border bg-card",
        disabled
          ? "opacity-60 cursor-not-allowed"
          : !isActive && "hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      <span className="hidden md:inline text-base leading-none shrink-0">
        {option.icon}
      </span>
      <div
        className={cn(
          "text-[11px] font-medium leading-tight w-full md:w-auto md:flex-1 md:min-w-0 break-words",
          isActive ? "text-primary" : "text-foreground",
        )}
      >
        {option.title}
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// DayPlanEditor — the per-week, all-days-expanded planner
// ---------------------------------------------------------------------------

export interface DayPlanEditorProps {
  product: MealPlanProduct<MealPlanProductRef>
  dailyChoices: Record<string, string> | null | undefined
  onSetDay: (date: string, menuKey: string) => void
  /** Small eyebrow line above the week title (e.g. "Planning lunches for Ana"). */
  eyebrow?: string
  /** When provided, renders a "Done" button. */
  onClose?: () => void
  /** When provided, renders a "Remove this week" button. */
  onRemove?: () => void
  removeLabel?: string
  doneLabel?: string
  /** Read-only week: dishes render but are not tappable. */
  disabled?: boolean
}

export function DayPlanEditor({
  product,
  dailyChoices,
  onSetDay,
  eyebrow,
  onClose,
  onRemove,
  removeLabel = "Remove this week",
  doneLabel = "Done",
  disabled = false,
}: DayPlanEditorProps) {
  const dates = weekdayDates(product)
  const menuPool: MenuOption[] = product.menuOptions

  return (
    <div className="space-y-3 max-w-4xl mx-auto">
      {/* Editor header — single row, compact */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && (
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {eyebrow}
            </div>
          )}
          <div className="text-sm font-semibold text-foreground">
            {product.weekLabel} · {formatCoverageRange(product)}
          </div>
        </div>
        {(onRemove || onClose) && (
          <div className="flex items-center gap-2 shrink-0">
            {onRemove && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRemove}
              >
                {removeLabel}
              </Button>
            )}
            {onClose && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
              >
                {doneLabel}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* All weekdays expanded — one row per day. */}
      <div className="rounded-lg border border-border bg-card divide-y divide-border/60">
        {dates.map((d) => {
          const dayPick = dailyChoices?.[d] ?? null
          return (
            <div
              key={d}
              className="flex flex-col md:flex-row md:items-center md:gap-2 p-1.5"
            >
              <div className="md:min-w-[44px] md:text-center px-1 mb-1 md:mb-0">
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  {formatWeekdayShort(d)} {formatDayNum(d)}
                </span>
              </div>
              <div
                className="grid gap-1 md:flex-1"
                style={{
                  gridTemplateColumns: `repeat(${menuPool.length},minmax(0,1fr))`,
                }}
              >
                {menuPool.map((opt) => (
                  <DishButton
                    key={opt.key}
                    option={opt}
                    isActive={dayPick === opt.key}
                    disabled={disabled}
                    onClick={() => onSetDay(d, opt.key)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
