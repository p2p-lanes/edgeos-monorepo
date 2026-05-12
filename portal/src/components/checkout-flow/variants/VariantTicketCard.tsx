"use client"

import { ShoppingBag } from "lucide-react"
import Image from "next/image"
import { useTranslation } from "react-i18next"
import ExpandableDescription from "@/components/ui/ExpandableDescription"
import QuantitySelector, {
  resolveMaxQuantity,
  supportsQuantitySelector,
} from "@/components/ui/QuantitySelector"
import { resolveTierPhaseState } from "@/helpers/tierPhaseState"
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
  /** Optional hero image surfaced at the top of the section card. */
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
 *  theme, those drive `--ticket-card-bg` / `--ticket-card-fg` and the
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

  return (
    <div
      className={cn(
        "px-4 py-3 transition-colors",
        isAdded && "bg-primary/10",
        rowDisabled && "opacity-40",
      )}
    >
      <div className="flex items-start gap-3">
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
        <div className="text-right shrink-0">
          {hasDiscount && (
            <div className="text-[11px] text-muted-foreground line-through leading-none">
              {formatCurrency(product.compare_price ?? 0, product.currency)}
            </div>
          )}
          <div className="text-sm font-semibold text-foreground">
            {formatCurrency(product.price, product.currency)}
          </div>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        {showStepper ? (
          <QuantitySelector
            size="md"
            value={quantity}
            min={0}
            max={max}
            onIncrement={() => handleQuantityChange(quantity + 1)}
            onDecrement={() =>
              handleQuantityChange(Math.max(0, quantity - 1))
            }
            onAdd={() => handleAdd(1)}
          />
        ) : (
          <button
            type="button"
            onClick={() => handleQuantityChange(isAdded ? 0 : 1)}
            disabled={rowDisabled}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
              isAdded
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-foreground border-border hover:bg-muted",
              rowDisabled && "cursor-not-allowed",
            )}
          >
            {isAdded ? "Added" : "Add"}
          </button>
        )}
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
  //  * `surface = "theme"` → bind the theme's `--ticket-card-bg` /
  //    `--ticket-card-fg` to the card-scoped CSS variables so inner
  //    elements (h3 with `text-foreground`, description with
  //    `text-muted-foreground`, dividers via `--border`) all repaint
  //    onto the card surface in one go. Falls back to the global
  //    `--card` / `--card-foreground` when the tenant didn't set
  //    card colours — that's the legacy single-mode behaviour.
  const surfaceStyle: React.CSSProperties =
    surface === "theme"
      ? ({
          "--card": "var(--ticket-card-bg, var(--card))",
          "--card-foreground": "var(--ticket-card-fg, var(--card-foreground))",
          "--foreground": "var(--ticket-card-fg, var(--card-foreground))",
          "--muted-foreground":
            "color-mix(in srgb, var(--ticket-card-fg, var(--card-foreground)) 75%, transparent)",
          "--border":
            "color-mix(in srgb, var(--ticket-card-fg, var(--card-foreground)) 18%, transparent)",
          background: "var(--ticket-card-bg, var(--card))",
          color: "var(--ticket-card-fg, var(--card-foreground))",
        } as React.CSSProperties)
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
      <header className="px-4 pt-4 pb-2">
        <h3 className="font-semibold text-foreground text-base">
          {section.label}
        </h3>
        {section.description && (
          <ExpandableDescription
            text={section.description}
            clamp={3}
            className="text-sm text-muted-foreground mt-1 whitespace-pre-line"
          />
        )}
      </header>
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
      ? ({
          "--card": "var(--ticket-card-bg, var(--card))",
          "--card-foreground": "var(--ticket-card-fg, var(--card-foreground))",
          "--foreground": "var(--ticket-card-fg, var(--card-foreground))",
          "--muted-foreground":
            "color-mix(in srgb, var(--ticket-card-fg, var(--card-foreground)) 75%, transparent)",
          "--border":
            "color-mix(in srgb, var(--ticket-card-fg, var(--card-foreground)) 18%, transparent)",
          background: "var(--ticket-card-bg, var(--card))",
          color: "var(--ticket-card-fg, var(--card-foreground))",
        } as React.CSSProperties)
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
