"use client"

import { Check, ChevronRight, Plus, ShoppingBag } from "lucide-react"
import Image from "next/image"
import { useTranslation } from "react-i18next"
import ExpandableDescription from "@/components/ui/ExpandableDescription"
import QuantitySelector, {
  resolveMaxQuantity,
  supportsQuantitySelector,
} from "@/components/ui/QuantitySelector"
import { resolveTierPhaseState } from "@/helpers/tierPhaseState"
import { stepCardSurfaceStyle } from "@/lib/stepCardSurface"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import { formatCheckoutDate, formatCurrency } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"
import type { VariantProps } from "../registries/variantRegistry"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Aspect-ratio token a tenant picks per section. Square/landscape kept off
 * the menu on purpose — anything more extreme than 3:2 ate the cards in the
 * design pass. */
const ASPECT_CLASSES = {
  "16:9": "aspect-[16/9]",
  "3:2": "aspect-[3/2]",
} as const
type SectionImageAspect = keyof typeof ASPECT_CLASSES

interface TicketCardSection {
  key: string
  label: string
  order: number
  product_ids: string[]
  /** Optional hero image surfaced at the top of the section card.
   *  Renders as a clean photo with no overlay — the title and
   *  description follow below in the card body. */
  image_url?: string
  /** Optional aspect override; defaults to 16:9. */
  image_aspect?: SectionImageAspect
  /** Optional rich-text description rendered with a single Ver más expander. */
  description?: string
}

type TicketCardVariant = "stacked" | "tabs" | "compact"

/** Surface for the section card.
 *
 *  `theme` (default) — bg/text resolve from the popup theme. When the
 *  tenant sets `card_background_color` / `card_foreground_color` in their
 *  theme, those drive `--step-card-bg` / `--step-card-fg` and the
 *  card uses them; otherwise the card falls back to `--card` /
 *  `--card-foreground` from the global mode palette.
 *
 *  `light` / `dark` — hard-coded oklch presets pinned via inline style,
 *  overriding everything for this step's card subtree. Useful when the
 *  popup theme mode disagrees with what one specific step needs (e.g. a
 *  dark popup with one cream cards step) and the tenant can't or doesn't
 *  want to express that via theme tokens.
 */
type TicketCardSurface = "theme" | "light" | "dark"

const SURFACE_STYLE: Record<
  Exclude<TicketCardSurface, "theme">,
  Record<string, string>
> = {
  // Override the CSS variables that the card body consumes so descendants
  // inherit the locked surface without needing component-level prop drilling.
  light: {
    "--card": "oklch(0.985 0 0)",
    "--card-foreground": "oklch(0.145 0 0)",
    "--foreground": "oklch(0.145 0 0)",
    "--muted": "oklch(0.965 0.005 285)",
    "--muted-foreground": "oklch(0.45 0.01 260)",
    "--border": "oklch(0.9 0.005 285)",
  },
  dark: {
    "--card": "oklch(0.205 0.015 285)",
    "--card-foreground": "oklch(0.985 0 0)",
    "--foreground": "oklch(0.985 0 0)",
    "--muted": "oklch(0.26 0.005 285)",
    "--muted-foreground": "oklch(0.7 0.02 260)",
    "--border": "oklch(0.3 0.005 285)",
  },
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseSections(
  templateConfig: VariantProps["templateConfig"],
): TicketCardSection[] {
  const raw = templateConfig?.sections
  if (!Array.isArray(raw) || raw.length === 0) return []
  return [...(raw as TicketCardSection[])].sort((a, b) => a.order - b.order)
}

function parseVariant(
  templateConfig: VariantProps["templateConfig"],
): TicketCardVariant {
  const v = templateConfig?.variant
  if (v === "tabs" || v === "compact") return v
  return "stacked"
}

function parseSurface(
  templateConfig: VariantProps["templateConfig"],
): TicketCardSurface {
  const s = templateConfig?.surface
  if (s === "light" || s === "dark") return s
  return "theme"
}

function resolveAspectClass(aspect?: SectionImageAspect): string {
  return ASPECT_CLASSES[aspect ?? "16:9"]
}

// ---------------------------------------------------------------------------
// Product row — shared by all design variants
// ---------------------------------------------------------------------------

function ProductRow({
  product,
  stepType,
}: { product: ProductsPass; stepType: string }) {
  const { t } = useTranslation()
  const { cart, addDynamicItem, removeDynamicItem, updateDynamicQuantity } =
    useCheckout()

  const items = cart.dynamicItems[stepType] ?? []
  const quantity = items.find((i) => i.productId === product.id)?.quantity ?? 0
  const isAdded = quantity > 0
  const showStepper = supportsQuantitySelector(product.max_per_order)
  const max = resolveMaxQuantity({
    max_per_order: product.max_per_order,
    total_stock_remaining: product.total_stock_remaining,
    start_date: product.start_date,
    end_date: product.end_date,
  })
  const tierState = resolveTierPhaseState(product)
  const rowDisabled = tierState.blocked && !isAdded
  const hasDiscount =
    product.compare_price != null && product.compare_price > product.price
  // Once a buyer adds more than one of the same product, show the line
  // SUBTOTAL as the primary price (so the number to the right of the
  // stepper actually matches what gets added to their total) and demote
  // the unit price to a quiet "c/u" footnote underneath. Without this
  // split it's ambiguous whether "$300,000" is per-unit or line-total.
  const subtotal = product.price * quantity
  const showSubtotal = quantity > 1

  const handleAdd = (qty: number = 1) => {
    addDynamicItem(stepType, {
      productId: product.id,
      product,
      quantity: qty,
      price: product.price,
      stepType,
    })
  }

  const handleQuantityChange = (qty: number) => {
    if (qty <= 0) {
      removeDynamicItem(stepType, product.id)
      return
    }
    if (quantity === 0) {
      handleAdd(qty)
      return
    }
    updateDynamicQuantity(stepType, product.id, qty)
  }

  // CTA palette mirrors the inverted "+" tile in QuantitySelector:
  // PRIMARY (verde-marino) fill with ACCENT (gold) text/icon. Pops harder
  // against the cream card surface than the previous gold-on-dark
  // treatment. When added, swap to a softer accent fill so the toggle
  // state is visually distinct without two competing dark pills on one
  // row.
  const ctaClass = cn(
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold tracking-wide shrink-0 transition-all whitespace-nowrap",
    "shadow-sm border border-[color:var(--primary,transparent)]",
    isAdded
      ? "bg-[color:var(--accent,theme(colors.foreground))] text-[color:var(--primary,theme(colors.background))]"
      : "bg-[color:var(--primary,theme(colors.foreground))] text-[color:var(--accent,theme(colors.background))] hover:brightness-110 active:scale-[0.98]",
    rowDisabled && "cursor-not-allowed opacity-50",
  )

  // Row click = primary "add" affordance. Toggle products (max_per_order=1)
  // flip in/out of the cart; multi-quantity products increment up to `max`.
  // The +/- stepper and Add button below still take priority via
  // stopPropagation so users can decrement / fine-tune without the row
  // double-firing. Disabled rows opt out of the click + focus ring.
  const handleRowActivate = () => {
    if (rowDisabled) return
    if (showStepper) {
      if (quantity >= max) return
      handleQuantityChange(quantity + 1)
      return
    }
    handleQuantityChange(isAdded ? 0 : 1)
  }

  const stepperAtMax = showStepper && quantity >= max
  const rowClickable = !rowDisabled && !stepperAtMax

  return (
    <div
      role={rowClickable ? "button" : undefined}
      tabIndex={rowClickable ? 0 : undefined}
      aria-disabled={rowDisabled || undefined}
      aria-label={
        rowClickable
          ? isAdded && !showStepper
            ? t("checkout.actions.remove_aria", {
                defaultValue: "Remove from cart",
              })
            : t("checkout.actions.add_aria", {
                defaultValue: "Add to cart",
              })
          : undefined
      }
      onClick={rowClickable ? handleRowActivate : undefined}
      onKeyDown={
        rowClickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                handleRowActivate()
              }
            }
          : undefined
      }
      className={cn(
        "px-4 py-3 transition-colors outline-none",
        isAdded && "bg-[color:var(--accent,theme(colors.muted))]/10",
        rowDisabled && "opacity-40 cursor-not-allowed",
        rowClickable &&
          "cursor-pointer hover:bg-[color:var(--accent,theme(colors.muted))]/15 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--accent,theme(colors.foreground))]/40",
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-medium text-foreground text-sm">
              {product.name}
            </h4>
            {tierState.badge && (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1 py-0.5">
                {tierState.badge}
              </span>
            )}
          </div>
          {(product.start_date || product.end_date) && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {product.start_date && formatCheckoutDate(product.start_date)}
              {product.start_date && product.end_date && " – "}
              {product.end_date && formatCheckoutDate(product.end_date)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4 shrink-0">
          {/* Price column switches typography + color the moment a
              product is added, so a glance down the list immediately
              tells you which rows are "in cart" versus quotes. Unselected
              → small, muted, mid-weight (informational). Selected →
              one step bigger, bold, painted in the brand accent (gold on
              Amanita) so the active line-item pops. Color transitions
              smoothly; size/weight snap is part of the affordance. */}
          <div
            className={cn(
              "text-right leading-tight transition-all duration-200 ease-out",
              isAdded ? "-translate-y-0.5" : "translate-y-0",
            )}
          >
            {hasDiscount && !showSubtotal && (
              <div
                className={cn(
                  "text-[11px] line-through leading-none transition-colors duration-200",
                  isAdded ? "text-foreground/60" : "text-muted-foreground",
                )}
              >
                {formatCurrency(product.compare_price ?? 0)}
              </div>
            )}
            <div
              className={cn(
                "transition-all duration-200 ease-out leading-tight tabular-nums",
                isAdded
                  ? "text-base font-bold text-[color:var(--accent,theme(colors.foreground))]"
                  : "text-sm font-medium text-muted-foreground",
              )}
            >
              {formatCurrency(showSubtotal ? subtotal : product.price)}
            </div>
            {showSubtotal && (
              <div className="text-[10px] text-muted-foreground leading-none mt-0.5 tabular-nums">
                {formatCurrency(product.price)}{" "}
                {t("checkout.actions.per_unit", { defaultValue: "c/u" })}
              </div>
            )}
          </div>
          {/* Thin vertical separator so the stepper feels visually
              detached from the price column instead of crowding it. */}
          <div className="border-l border-current/10 pl-4 h-9 flex items-center">
          {showStepper ? (
            <QuantitySelector
              size="md"
              tone="accent"
              value={quantity}
              min={0}
              max={max}
              onIncrement={() => handleQuantityChange(quantity + 1)}
              onDecrement={() => handleQuantityChange(Math.max(0, quantity - 1))}
              onAdd={() => handleAdd(1)}
            />
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleQuantityChange(isAdded ? 0 : 1)
              }}
              disabled={rowDisabled}
              className={ctaClass}
              aria-label={
                isAdded
                  ? t("checkout.actions.remove_aria", {
                      defaultValue: "Remove from cart",
                    })
                  : t("checkout.actions.add_aria", {
                      defaultValue: "Add to cart",
                    })
              }
            >
              {isAdded ? (
                <>
                  <Check className="size-3.5 stroke-[2.5]" />
                  {t("checkout.actions.added", { defaultValue: "Added" })}
                </>
              ) : (
                <>
                  <Plus className="size-3.5 stroke-[3]" />
                  {t("checkout.actions.add", { defaultValue: "Add" })}
                </>
              )}
            </button>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section card — image, description (with Ver más), product rows
// ---------------------------------------------------------------------------

function SectionCard({
  section,
  products,
  stepType,
  surface,
}: {
  section: TicketCardSection
  products: ProductsPass[]
  stepType: string
  surface: TicketCardSurface
}) {
  if (products.length === 0) return null

  // Resolution order:
  //  * `surface = "light" | "dark"` → pin a hardcoded preset on the card
  //    root, overriding everything for the subtree.
  //  * `surface = "theme"` → use the shared step-card surface style so
  //    this card paints with the same `--step-card-bg`/`-fg` palette as
  //    every other card in the checkout. Falls back through the helper
  //    chain (`--checkout-card-bg` → `--card`) when no card colours are
  //    configured.
  const surfaceStyle: React.CSSProperties =
    surface === "theme"
      ? stepCardSurfaceStyle()
      : (SURFACE_STYLE[surface] as React.CSSProperties)

  return (
    <article
      style={surfaceStyle}
      className="rounded-2xl overflow-hidden border border-border shadow-sm"
    >
      {section.image_url && (
        <div
          className={cn(
            "relative w-full bg-muted",
            resolveAspectClass(section.image_aspect),
          )}
        >
          <Image
            src={section.image_url}
            alt={section.label}
            fill
            // Source thumbnails from prod / Gemstore are typically 800px on
            // the long side. Tell Next we don't need anything larger so it
            // doesn't request a 1440px variant that just upscales the
            // 800px source. quality 95 preserves the visible texture
            // without the default 75% JPEG-y blur.
            sizes="(max-width: 768px) 100vw, 720px"
            quality={95}
            className="object-cover"
            priority={false}
          />
        </div>
      )}
      <header className="px-4 pt-4 pb-1">
        <h3 className="font-semibold text-foreground text-base">
          {section.label}
        </h3>
      </header>
      {section.description && (
        <div className="px-4 pt-1 pb-2">
          <ExpandableDescription
            text={section.description}
            clamp={3}
            className="text-sm text-muted-foreground whitespace-pre-line"
            // Branded toggle: uppercase micro-caps + chevron glyph in the
            // theme accent colour. Falls back to the card's foreground
            // when the tenant didn't set an accent, so other popups stay
            // readable without the plain-blue link.
            buttonClassName={cn(
              "mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] font-bold",
              "text-[color:var(--accent,currentColor)] hover:opacity-80",
              "transition-opacity no-underline hover:no-underline",
              "after:content-['_›'] after:font-normal after:text-base after:leading-none after:relative after:top-[-1px]",
            )}
          />
        </div>
      )}
      <div className="divide-y divide-border">
        {products.map((p) => (
          <ProductRow key={p.id} product={p} stepType={stepType} />
        ))}
      </div>
    </article>
  )
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

function StackedLayout({
  groups,
  stepType,
  surface,
}: {
  groups: { section: TicketCardSection; products: ProductsPass[] }[]
  stepType: string
  surface: TicketCardSurface
}) {
  return (
    <div className="space-y-4">
      {groups.map(({ section, products }) => (
        <SectionCard
          key={section.key}
          section={section}
          products={products}
          stepType={stepType}
          surface={surface}
        />
      ))}
    </div>
  )
}

function CompactLayout({
  groups,
  stepType,
  surface,
}: {
  groups: { section: TicketCardSection; products: ProductsPass[] }[]
  stepType: string
  surface: TicketCardSurface
}) {
  // Compact strips the image and renders sections as dense rows. Useful when
  // a popup has many sections and the tenant wants a "list view". Same
  // surface resolution as the stacked SectionCard — see comments there.
  const surfaceStyle: React.CSSProperties =
    surface === "theme"
      ? stepCardSurfaceStyle()
      : (SURFACE_STYLE[surface] as React.CSSProperties)
  return (
    <div
      style={surfaceStyle}
      className="rounded-2xl overflow-hidden border border-border divide-y divide-border"
    >
      {groups.map(({ section, products }) => (
        <div key={section.key}>
          <header className="px-4 py-2 bg-muted">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              {section.label}
            </h3>
          </header>
          <div className="divide-y divide-border">
            {products.map((p) => (
              <ProductRow key={p.id} product={p} stepType={stepType} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function TabsLayout({
  groups,
  stepType,
  surface,
}: {
  groups: { section: TicketCardSection; products: ProductsPass[] }[]
  stepType: string
  surface: TicketCardSurface
}) {
  // Renders section labels as a horizontal tab strip and shows one section's
  // contents at a time. Useful for narrow viewports + many sections.
  const { t } = useTranslation()
  const tabKey = (i: number) =>
    groups[i]?.section.key ?? `tab-${i}`

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {groups.map(({ section }, i) => (
          <button
            key={section.key}
            type="button"
            data-tab-target={tabKey(i)}
            className="px-3 py-1.5 rounded-full text-xs font-medium border border-border bg-card hover:bg-muted whitespace-nowrap aria-selected:bg-primary aria-selected:text-primary-foreground"
            aria-label={t("common.show", { default: "Show" }) + ` ${section.label}`}
          >
            {section.label}
          </button>
        ))}
      </div>
      {/* Browser-native tab switching avoided to keep this server-renderable.
       * Sections all stay visible; tabs become section anchors. */}
      <div className="space-y-4">
        {groups.map(({ section, products }) => (
          <SectionCard
            key={section.key}
            section={section}
            products={products}
            stepType={stepType}
            surface={surface}
          />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export default function VariantTicketCard({
  products,
  stepType,
  templateConfig,
}: VariantProps) {
  const sections = parseSections(templateConfig)
  const variant = parseVariant(templateConfig)
  const surface = parseSurface(templateConfig)
  const { t } = useTranslation()

  // No sections configured — show every product in a single ungrouped card.
  // Keeps the renderer safe for tenants who just dropped a tickets step in
  // without configuring sections yet.
  const groups = sections.length
    ? sections
        .map((section) => ({
          section,
          products: section.product_ids
            .map((id) => products.find((p) => p.id === id))
            .filter(Boolean) as ProductsPass[],
        }))
        .filter((g) => g.products.length > 0)
    : products.length
      ? [
          {
            section: {
              key: "all",
              label: t("checkout.steps.tickets_title", { default: "Tickets" }),
              order: 0,
              product_ids: products.map((p) => p.id),
            } as TicketCardSection,
            products,
          },
        ]
      : []

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <ShoppingBag className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">
          {t("checkout.tickets_empty", {
            default: "No tickets available yet.",
          })}
        </p>
      </div>
    )
  }

  if (variant === "compact") {
    return (
      <CompactLayout groups={groups} stepType={stepType} surface={surface} />
    )
  }
  if (variant === "tabs") {
    return <TabsLayout groups={groups} stepType={stepType} surface={surface} />
  }
  return (
    <StackedLayout groups={groups} stepType={stepType} surface={surface} />
  )
}
