"use client"

import { Check, Plus, ShoppingBag } from "lucide-react"
import Image from "next/image"
import type { CSSProperties } from "react"
import { useTranslation } from "react-i18next"
import ExpandableDescription from "@/components/ui/ExpandableDescription"
import QuantitySelector, {
  resolveMaxQuantity,
  supportsQuantitySelector,
} from "@/components/ui/QuantitySelector"
import { stepCardSurfaceStyle } from "@/lib/stepCardSurface"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import { formatCurrency } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"
import type { VariantProps } from "../registries/variantRegistry"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Aspect-ratio token a tenant picks per section. Square/landscape kept off
 *  the menu on purpose — anything more extreme than 3:2 ate the cards in
 *  the design pass. */
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
  /** Optional hero image surfaced at the top of the section card. Renders
   *  with no overlay — title and description follow below in the body. */
  image_url?: string
  /** Optional aspect override; defaults to 16:9. */
  image_aspect?: SectionImageAspect
  /** Optional rich-text description rendered with a single expandable
   *  "Read more" toggle. */
  description?: string
}

type TicketCardVariant = "stacked" | "tabs" | "compact"

/** Surface for the section card.
 *
 *  `theme` (default) — bg/text resolve from the popup theme via
 *  stepCardSurfaceStyle, falling through to `--card` / `--card-foreground`
 *  when no card colours are configured.
 *
 *  `light` / `dark` — hardcoded oklch presets pinned via inline style,
 *  overriding everything for this step's card subtree. Useful when the
 *  popup theme mode and one specific step need to disagree (e.g. a dark
 *  popup with one cream cards step).
 */
type TicketCardSurface = "theme" | "light" | "dark"

const SURFACE_STYLE: Record<
  Exclude<TicketCardSurface, "theme">,
  Record<string, string>
> = {
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

/** Tenant-wide aspect, set once at template_config root and applied to every
 *  section's hero image (the backoffice copy reads "Applied to every section's
 *  hero image"). A per-section `image_aspect` still wins when present. */
function parseImageAspect(
  templateConfig: VariantProps["templateConfig"],
): SectionImageAspect | undefined {
  const a = templateConfig?.image_aspect
  return a === "16:9" || a === "3:2" ? a : undefined
}

function resolveAspectClass(aspect?: SectionImageAspect): string {
  return ASPECT_CLASSES[aspect ?? "16:9"]
}

function resolveSurfaceStyle(surface: TicketCardSurface): CSSProperties {
  return surface === "theme"
    ? stepCardSurfaceStyle()
    : (SURFACE_STYLE[surface] as CSSProperties)
}

// ---------------------------------------------------------------------------
// Product row — shared by all design variants
// ---------------------------------------------------------------------------

function ProductRow({
  product,
  stepType,
}: {
  product: ProductsPass
  stepType: string
}) {
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
  })
  // The product's own `disabled` flag is the only gate today — out-of-
  // stock / not-yet-on-sale / cap-reached are folded into it upstream.
  // Disabled rows still let the buyer adjust the quantity of an item
  // they already added; only NEW additions are blocked.
  const rowDisabled = !!product.disabled && !isAdded
  const hasDiscount =
    product.compare_price != null && product.compare_price > product.price
  // Once a buyer adds more than one of the same product, show the line
  // SUBTOTAL as the primary price (so the number to the right of the
  // stepper matches what gets added to their total) and demote the unit
  // price to a quiet "per-unit" footnote.
  const subtotal = product.price * quantity
  const showSubtotal = quantity > 1

  const handleAdd = (qty = 1) => {
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
  // PRIMARY fill with ACCENT text/icon. Pops harder against light card
  // surfaces. When added, swap to a softer accent fill so the toggle
  // state is visually distinct.
  const ctaClass = cn(
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold tracking-wide shrink-0 transition-all whitespace-nowrap",
    "shadow-sm border border-[color:var(--primary,transparent)]",
    isAdded
      ? "bg-[color:var(--accent,theme(colors.foreground))] text-[color:var(--primary,theme(colors.background))]"
      : "bg-[color:var(--primary,theme(colors.foreground))] text-[color:var(--accent,theme(colors.background))] hover:brightness-110 active:scale-[0.98]",
    rowDisabled && "cursor-not-allowed opacity-50",
  )

  // Row presentation: interactive controls (stepper, CTA button) are the
  // ONLY click targets — the row wrapper stays a plain <div> so we don't
  // nest <button>s (HTML invalid + hydration warning). Buyers tap the
  // stepper "+" or the Add pill explicitly; that's the standard e-commerce
  // pattern and keeps the markup a11y-clean without div role="button"
  // workarounds.
  return (
    <div
      className={cn(
        "px-4 py-3 transition-colors",
        isAdded && "bg-[color:var(--accent,theme(colors.muted))]/10",
        rowDisabled && "opacity-40",
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-foreground text-sm">
            {product.name}
          </h4>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          {/* Price column: unselected → small + muted (informational);
              selected → bigger + bold + accent-tinted so the active row
              pops. Color transitions smoothly; size/weight snap is part
              of the affordance. */}
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
                {t("checkout.actions.per_unit", { defaultValue: "ea." })}
              </div>
            )}
          </div>
          {/* Thin separator so the stepper feels detached from the price
              column instead of crowding it. */}
          <div className="border-l border-current/10 pl-4 h-9 flex items-center">
            {showStepper ? (
              <QuantitySelector
                size="md"
                tone="accent"
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
// Section card — image, description (with expandable), product rows
// ---------------------------------------------------------------------------

function SectionCard({
  section,
  products,
  stepType,
  surface,
  imageAspect,
}: {
  section: TicketCardSection
  products: ProductsPass[]
  stepType: string
  surface: TicketCardSurface
  imageAspect?: SectionImageAspect
}) {
  if (products.length === 0) return null

  return (
    <article
      style={resolveSurfaceStyle(surface)}
      className="rounded-2xl overflow-hidden border border-border shadow-sm"
    >
      {section.image_url && (
        <div
          className={cn(
            "relative w-full bg-muted",
            resolveAspectClass(section.image_aspect ?? imageAspect),
          )}
        >
          <Image
            src={section.image_url}
            alt={section.label}
            fill
            // Source thumbnails are typically 800px on the long side. Tell
            // Next we don't need anything larger so it doesn't request a
            // 1440px upscale of an 800px source. quality 95 preserves
            // visible texture without the default 75% JPEG blur.
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
            // theme accent colour. Falls back to currentColor when the
            // tenant didn't set an accent.
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

interface LayoutProps {
  groups: { section: TicketCardSection; products: ProductsPass[] }[]
  stepType: string
  surface: TicketCardSurface
  imageAspect?: SectionImageAspect
}

function StackedLayout({
  groups,
  stepType,
  surface,
  imageAspect,
}: LayoutProps) {
  return (
    <div className="space-y-4">
      {groups.map(({ section, products }) => (
        <SectionCard
          key={section.key}
          section={section}
          products={products}
          stepType={stepType}
          surface={surface}
          imageAspect={imageAspect}
        />
      ))}
    </div>
  )
}

function CompactLayout({ groups, stepType, surface }: LayoutProps) {
  // Compact strips the image and renders sections as dense rows. Useful
  // when a popup has many sections and the tenant wants a "list view".
  return (
    <div
      style={resolveSurfaceStyle(surface)}
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

function TabsLayout({ groups, stepType, surface, imageAspect }: LayoutProps) {
  // Renders section labels as a horizontal anchor strip; sections all
  // stay visible below. Kept server-renderable — no client-side tab state.
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {groups.map(({ section }) => (
          <a
            key={section.key}
            href={`#${section.key}`}
            className="px-3 py-1.5 rounded-full text-xs font-medium border border-border bg-card hover:bg-muted whitespace-nowrap"
            aria-label={`${t("common.show", { defaultValue: "Show" })} ${section.label}`}
          >
            {section.label}
          </a>
        ))}
      </div>
      <div className="space-y-4">
        {groups.map(({ section, products }) => (
          <div key={section.key} id={section.key}>
            <SectionCard
              section={section}
              products={products}
              stepType={stepType}
              surface={surface}
              imageAspect={imageAspect}
            />
          </div>
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
  const imageAspect = parseImageAspect(templateConfig)
  const { t } = useTranslation()

  // No sections configured — show every product in a single ungrouped
  // card so the renderer stays safe for tenants who just dropped a
  // tickets step in without configuring sections yet.
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
              label: t("checkout.steps.tickets_title", {
                defaultValue: "Tickets",
              }),
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
            defaultValue: "No tickets available yet.",
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
    return (
      <TabsLayout
        groups={groups}
        stepType={stepType}
        surface={surface}
        imageAspect={imageAspect}
      />
    )
  }
  return (
    <StackedLayout
      groups={groups}
      stepType={stepType}
      surface={surface}
      imageAspect={imageAspect}
    />
  )
}
