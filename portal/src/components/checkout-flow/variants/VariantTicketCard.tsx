"use client"

import { Check, CreditCard, Plus, ShoppingBag } from "lucide-react"
import Image from "next/image"
import type { CSSProperties } from "react"
import { useTranslation } from "react-i18next"
import ExpandableDescription from "@/components/ui/ExpandableDescription"
import QuantitySelector, {
  supportsQuantitySelector,
} from "@/components/ui/QuantitySelector"
import type {
  TicketAttendeeVM,
  TicketRowVM,
  TicketSectionVM,
} from "@/hooks/checkout/useTicketsStep"
import { useTicketsStep } from "@/hooks/checkout/useTicketsStep"
import { stepCardSurfaceStyle } from "@/lib/stepCardSurface"
import { cn } from "@/lib/utils"
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
  "16:9": "aspect-[16/9]", // Banner — panoramic, short cards
  "3:2": "aspect-[3/2]", // Classic — standard photo
  "1:1": "aspect-[1/1]", // Square — strong presence, CTA still visible
  "4:5": "aspect-[4/5]", // Portrait — image-forward, poster feel
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
// Parsers (presentational config only — business logic delegated to hook)
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
  return typeof a === "string" && a in ASPECT_CLASSES
    ? (a as SectionImageAspect)
    : undefined
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
// ProductRow — contract-aware (pass_system path uses TicketRowVM)
// ---------------------------------------------------------------------------

/**
 * Pass-system product row: driven by a precomputed TicketRowVM from the hook.
 * Business logic (disabled, purchased, credit) lives in the hook, not here.
 */
function PassSystemProductRow({
  row,
  attendeeId,
  onToggle,
  onQuantityChange,
  isEditing,
}: {
  row: TicketRowVM
  attendeeId: string
  onToggle: (attendeeId: string, product: ProductsPass) => void
  onQuantityChange: (
    attendeeId: string,
    product: ProductsPass,
    qty: number,
  ) => void
  isEditing: boolean
}) {
  const { t } = useTranslation()
  const { product } = row

  const quantity = row.quantity
  const isAdded = row.selected || row.purchased
  const showStepper = row.usesStepper
  const max = row.maxQuantity

  // Purchased but not in credit-edit mode: render as locked
  const isPurchasedLocked = row.purchased && !row.editedForCredit
  // Disabled: either precomputed exclusivity/sale-state, or purchased-locked
  const rowDisabled = row.disabled || isPurchasedLocked

  const hasDiscount = row.comparePrice != null && row.comparePrice > row.price
  const subtotal = row.price * quantity
  const showSubtotal = quantity > 1

  const handleToggle = () => {
    onToggle(attendeeId, product)
  }

  const handleQuantityChange = (qty: number) => {
    onQuantityChange(attendeeId, product, qty)
  }

  const ctaClass = cn(
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold tracking-wide shrink-0 transition-all whitespace-nowrap",
    "shadow-sm border border-[color:var(--primary,transparent)]",
    isAdded
      ? "bg-[color:var(--accent,theme(colors.foreground))] text-[color:var(--primary-foreground,theme(colors.background))]"
      : "bg-[color:var(--primary,theme(colors.foreground))] text-[color:var(--primary-foreground,theme(colors.background))] hover:brightness-110 active:scale-[0.98]",
    rowDisabled && "cursor-not-allowed opacity-50",
  )

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
          <h4 className="font-medium text-foreground text-sm line-clamp-2">
            {product.name}
          </h4>
          {/* Credit indicator: visible when isEditing and product.edit */}
          {isEditing && row.editedForCredit && (
            <div className="flex items-center gap-1 mt-0.5">
              <CreditCard className="size-3 text-[color:var(--accent,currentColor)]" />
              <span className="text-[10px] text-[color:var(--accent,currentColor)] font-medium">
                {t("checkout.actions.give_up_for_credit", {
                  defaultValue: "Give up for credit",
                })}
              </span>
            </div>
          )}
          {/* Purchased badge */}
          {isPurchasedLocked && (
            <div className="mt-0.5">
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                {t("checkout.actions.purchased", {
                  defaultValue: "Purchased",
                })}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4 shrink-0">
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
                {formatCurrency(row.comparePrice ?? 0)}
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
              {formatCurrency(showSubtotal ? subtotal : row.price)}
            </div>
            {showSubtotal && (
              <div className="text-[10px] text-muted-foreground leading-none mt-0.5 tabular-nums">
                {formatCurrency(row.price)}{" "}
                {t("checkout.actions.per_unit", { defaultValue: "ea." })}
              </div>
            )}
          </div>
          <div className="border-l border-current/10 pl-4 h-9 flex items-center">
            {isPurchasedLocked ? (
              // Purchased and not in edit mode: just show check icon
              <div className="flex items-center gap-1 text-[color:var(--accent,theme(colors.foreground))]">
                <Check className="size-4 stroke-[2.5]" />
              </div>
            ) : showStepper ? (
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
                onAdd={() => handleToggle()}
              />
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleToggle()
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

/**
 * Open-checkout product row: reads state from the TicketRowVM (Slice 3).
 * All quantity/selection state is precomputed by useTicketsStep.
 * Actions route through the contract (view.toggleRow / view.setRowQuantity).
 */
function OpenCheckoutProductRow({
  row,
  onToggle,
  onQuantityChange,
}: {
  row: TicketRowVM
  onToggle: (attendeeId: string, product: ProductsPass) => void
  onQuantityChange: (
    attendeeId: string,
    product: ProductsPass,
    qty: number,
  ) => void
}) {
  const { t } = useTranslation()
  const { product, quantity, maxQuantity, selected, disabled } = row

  const isAdded = quantity > 0 || selected
  const showStepper = supportsQuantitySelector(product.max_per_order)
  const max = maxQuantity
  const rowDisabled = disabled && !isAdded
  const hasDiscount =
    product.compare_price != null && product.compare_price > product.price
  const subtotal = product.price * quantity
  const showSubtotal = quantity > 1

  const handleToggle = () => {
    onToggle("", product)
  }

  const handleQuantityChange = (qty: number) => {
    onQuantityChange("", product, qty)
  }

  const ctaClass = cn(
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold tracking-wide shrink-0 transition-all whitespace-nowrap",
    "shadow-sm border border-[color:var(--primary,transparent)]",
    isAdded
      ? "bg-[color:var(--accent,theme(colors.foreground))] text-[color:var(--primary-foreground,theme(colors.background))]"
      : "bg-[color:var(--primary,theme(colors.foreground))] text-[color:var(--primary-foreground,theme(colors.background))] hover:brightness-110 active:scale-[0.98]",
    rowDisabled && "cursor-not-allowed opacity-50",
  )

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
          <h4 className="font-medium text-foreground text-sm line-clamp-2">
            {product.name}
          </h4>
        </div>
        <div className="flex items-center gap-4 shrink-0">
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
                onAdd={() => handleToggle()}
              />
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleToggle()
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

function PassSystemSectionCard({
  section,
  attendeeId,
  onToggle,
  onQuantityChange,
  surface,
  imageAspect,
  isEditing,
}: {
  section: TicketSectionVM & {
    image_url?: string
    image_aspect?: string
    description?: string
  }
  attendeeId: string
  onToggle: (attendeeId: string, product: ProductsPass) => void
  onQuantityChange: (
    attendeeId: string,
    product: ProductsPass,
    qty: number,
  ) => void
  surface: TicketCardSurface
  imageAspect?: SectionImageAspect
  isEditing: boolean
}) {
  if (section.rows.length === 0) return null

  return (
    <article
      style={resolveSurfaceStyle(surface)}
      className="relative flex h-full w-full flex-col rounded-2xl overflow-hidden shadow-sm after:pointer-events-none after:absolute after:inset-0 after:rounded-2xl after:border after:border-border"
    >
      {section.image_url && (
        <div
          className={cn(
            "relative w-full bg-muted",
            resolveAspectClass(
              (section.image_aspect as SectionImageAspect) ?? imageAspect,
            ),
          )}
        >
          <Image
            src={section.image_url}
            alt={section.label}
            fill
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
            buttonClassName={cn(
              "mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] font-bold",
              "text-[color:var(--accent,currentColor)] hover:opacity-80",
              "transition-opacity no-underline hover:no-underline",
              "after:content-['_›'] after:font-normal after:text-base after:leading-none after:relative after:top-[-1px]",
            )}
          />
        </div>
      )}
      <div className="mt-auto divide-y divide-border border-t border-border">
        {section.rows.map((row) => (
          <PassSystemProductRow
            key={row.product.id}
            row={row}
            attendeeId={attendeeId}
            onToggle={onToggle}
            onQuantityChange={onQuantityChange}
            isEditing={isEditing}
          />
        ))}
      </div>
    </article>
  )
}

/**
 * Legacy-compatible SectionCard for open-checkout path.
 * Reads presentational config (image, description) from templateConfig sections.
 */
function OpenCheckoutSectionCard({
  section,
  rows,
  surface,
  imageAspect,
  onToggle,
  onQuantityChange,
}: {
  section: TicketCardSection
  rows: TicketRowVM[]
  surface: TicketCardSurface
  imageAspect?: SectionImageAspect
  onToggle: (attendeeId: string, product: ProductsPass) => void
  onQuantityChange: (
    attendeeId: string,
    product: ProductsPass,
    qty: number,
  ) => void
}) {
  if (rows.length === 0) return null

  return (
    <article
      style={resolveSurfaceStyle(surface)}
      className="relative flex h-full w-full flex-col rounded-2xl overflow-hidden shadow-sm after:pointer-events-none after:absolute after:inset-0 after:rounded-2xl after:border after:border-border"
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
            buttonClassName={cn(
              "mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] font-bold",
              "text-[color:var(--accent,currentColor)] hover:opacity-80",
              "transition-opacity no-underline hover:no-underline",
              "after:content-['_›'] after:font-normal after:text-base after:leading-none after:relative after:top-[-1px]",
            )}
          />
        </div>
      )}
      <div className="mt-auto divide-y divide-border border-t border-border">
        {rows.map((row) => (
          <OpenCheckoutProductRow
            key={row.product.id}
            row={row}
            onToggle={onToggle}
            onQuantityChange={onQuantityChange}
          />
        ))}
      </div>
    </article>
  )
}

// ---------------------------------------------------------------------------
// Layouts — pass_system (per-attendee)
// ---------------------------------------------------------------------------

interface PassSystemLayoutProps {
  attendees: TicketAttendeeVM[]
  configSections: TicketCardSection[]
  onToggle: (attendeeId: string, product: ProductsPass) => void
  onQuantityChange: (
    attendeeId: string,
    product: ProductsPass,
    qty: number,
  ) => void
  surface: TicketCardSurface
  imageAspect?: SectionImageAspect
  isEditing: boolean
  variant: TicketCardVariant
}

/**
 * Merges VM section (rows + business state) with presentational config
 * (image_url, image_aspect, description) from the templateConfig sections.
 */
function mergedSectionWithPresentation(
  vmSection: TicketSectionVM,
  configSections: TicketCardSection[],
): TicketSectionVM & {
  image_url?: string
  image_aspect?: string
  description?: string
} {
  const config = configSections.find((s) => s.key === vmSection.key)
  return {
    ...vmSection,
    image_url: config?.image_url,
    image_aspect: config?.image_aspect,
    description: config?.description,
  }
}

function PassSystemStackedLayout({
  attendees,
  configSections,
  onToggle,
  onQuantityChange,
  surface,
  imageAspect,
  isEditing,
}: PassSystemLayoutProps) {
  const { t } = useTranslation()

  // When there is only one attendee, omit the attendee header for a cleaner
  // layout identical to the open-checkout single-bucket experience.
  const showAttendeeHeaders = attendees.length > 1

  return (
    <div className="space-y-8">
      {attendees.map((attendee) => (
        <div key={attendee.id}>
          {showAttendeeHeaders && (
            <div className="mb-3">
              <h3 className="font-semibold text-foreground text-sm">
                {attendee.name ||
                  t("checkout.attendee_label", { defaultValue: "Attendee" })}
              </h3>
              {attendee.category && (
                <p className="text-xs text-muted-foreground">
                  {attendee.category}
                </p>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-stretch justify-center gap-4">
            {attendee.sections.map((vmSection) => {
              const section = mergedSectionWithPresentation(
                vmSection,
                configSections,
              )
              return (
                <div key={vmSection.key} className="flex w-full sm:w-[340px]">
                  <PassSystemSectionCard
                    section={section}
                    attendeeId={attendee.id}
                    onToggle={onToggle}
                    onQuantityChange={onQuantityChange}
                    surface={surface}
                    imageAspect={imageAspect}
                    isEditing={isEditing}
                  />
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function PassSystemCompactLayout({
  attendees,
  onToggle,
  onQuantityChange,
  surface,
  isEditing,
}: PassSystemLayoutProps) {
  const { t } = useTranslation()
  const showAttendeeHeaders = attendees.length > 1

  return (
    <div className="space-y-6">
      {attendees.map((attendee) => (
        <div key={attendee.id}>
          {showAttendeeHeaders && (
            <div className="mb-2">
              <h3 className="font-semibold text-foreground text-sm">
                {attendee.name ||
                  t("checkout.attendee_label", { defaultValue: "Attendee" })}
              </h3>
            </div>
          )}
          <div
            style={resolveSurfaceStyle(surface)}
            className="rounded-2xl overflow-hidden border border-border divide-y divide-border"
          >
            {attendee.sections.map((vmSection) => (
              <div key={vmSection.key}>
                <header className="px-4 py-2 bg-muted">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                    {vmSection.label}
                  </h3>
                </header>
                <div className="divide-y divide-border">
                  {vmSection.rows.map((row) => (
                    <PassSystemProductRow
                      key={row.product.id}
                      row={row}
                      attendeeId={attendee.id}
                      onToggle={onToggle}
                      onQuantityChange={onQuantityChange}
                      isEditing={isEditing}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function PassSystemTabsLayout({
  attendees,
  configSections,
  onToggle,
  onQuantityChange,
  surface,
  imageAspect,
  isEditing,
}: PassSystemLayoutProps) {
  const { t } = useTranslation()
  const showAttendeeHeaders = attendees.length > 1

  return (
    <div className="space-y-8">
      {attendees.map((attendee) => (
        <div key={attendee.id}>
          {showAttendeeHeaders && (
            <div className="mb-3">
              <h3 className="font-semibold text-foreground text-sm">
                {attendee.name ||
                  t("checkout.attendee_label", { defaultValue: "Attendee" })}
              </h3>
            </div>
          )}
          <div className="space-y-3">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {attendee.sections.map((vmSection) => (
                <a
                  key={vmSection.key}
                  href={`#${attendee.id}-${vmSection.key}`}
                  className="px-3 py-1.5 rounded-full text-xs font-medium border border-border bg-card hover:bg-muted whitespace-nowrap"
                  aria-label={`${t("common.show", { defaultValue: "Show" })} ${vmSection.label}`}
                >
                  {vmSection.label}
                </a>
              ))}
            </div>
            <div className="space-y-4">
              {attendee.sections.map((vmSection) => {
                const section = mergedSectionWithPresentation(
                  vmSection,
                  configSections,
                )
                return (
                  <div
                    key={vmSection.key}
                    id={`${attendee.id}-${vmSection.key}`}
                  >
                    <PassSystemSectionCard
                      section={section}
                      attendeeId={attendee.id}
                      onToggle={onToggle}
                      onQuantityChange={onQuantityChange}
                      surface={surface}
                      imageAspect={imageAspect}
                      isEditing={isEditing}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Layouts — open checkout (flat, no attendee axis — identical to old behavior)
// ---------------------------------------------------------------------------

interface OpenCheckoutLayoutProps {
  groups: { section: TicketCardSection; rows: TicketRowVM[] }[]
  surface: TicketCardSurface
  imageAspect?: SectionImageAspect
  onToggle: (attendeeId: string, product: ProductsPass) => void
  onQuantityChange: (
    attendeeId: string,
    product: ProductsPass,
    qty: number,
  ) => void
}

function OpenCheckoutStackedLayout({
  groups,
  surface,
  imageAspect,
  onToggle,
  onQuantityChange,
}: OpenCheckoutLayoutProps) {
  return (
    <div className="flex flex-wrap items-stretch justify-center gap-4">
      {groups.map(({ section, rows }) => (
        <div key={section.key} className="flex w-full sm:w-[340px]">
          <OpenCheckoutSectionCard
            section={section}
            rows={rows}
            surface={surface}
            imageAspect={imageAspect}
            onToggle={onToggle}
            onQuantityChange={onQuantityChange}
          />
        </div>
      ))}
    </div>
  )
}

function OpenCheckoutCompactLayout({
  groups,
  surface,
  onToggle,
  onQuantityChange,
}: OpenCheckoutLayoutProps) {
  return (
    <div
      style={resolveSurfaceStyle(surface)}
      className="rounded-2xl overflow-hidden border border-border divide-y divide-border"
    >
      {groups.map(({ section, rows }) => (
        <div key={section.key}>
          <header className="px-4 py-2 bg-muted">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              {section.label}
            </h3>
          </header>
          <div className="divide-y divide-border">
            {rows.map((row) => (
              <OpenCheckoutProductRow
                key={row.product.id}
                row={row}
                onToggle={onToggle}
                onQuantityChange={onQuantityChange}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function OpenCheckoutTabsLayout({
  groups,
  surface,
  imageAspect,
  onToggle,
  onQuantityChange,
}: OpenCheckoutLayoutProps) {
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
        {groups.map(({ section, rows }) => (
          <div key={section.key} id={section.key}>
            <OpenCheckoutSectionCard
              section={section}
              rows={rows}
              surface={surface}
              imageAspect={imageAspect}
              onToggle={onToggle}
              onQuantityChange={onQuantityChange}
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
  // Business logic via contract — routes to passesProvider or dynamicItems
  const view = useTicketsStep({ stepType, templateConfig, products })

  const configSections = parseSections(templateConfig)
  const variant = parseVariant(templateConfig)
  const surface = parseSurface(templateConfig)
  const imageAspect = parseImageAspect(templateConfig)
  const { t } = useTranslation()

  // Empty state — guard against vacuous-truth: an empty attendees array makes
  // Array.every() return true, which would falsely report empty for pass_system
  // while data is still loading. Require at least one attendee before checking rows.
  const isEmpty =
    view.mode === "pass_system"
      ? view.attendees.length > 0 &&
        view.attendees.every((a) =>
          a.sections.every((s) => s.rows.length === 0),
        )
      : products.length === 0

  if (isEmpty) {
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

  // ---------------------------------------------------------------------------
  // pass_system path — per-attendee layout using contract VM
  // ---------------------------------------------------------------------------

  if (view.mode === "pass_system" && view.attendees.length > 0) {
    const layoutProps: PassSystemLayoutProps = {
      attendees: view.attendees,
      configSections,
      onToggle: view.toggleRow,
      onQuantityChange: view.setRowQuantity,
      surface,
      imageAspect,
      isEditing: view.isEditing,
      variant,
    }

    if (variant === "compact") {
      return <PassSystemCompactLayout {...layoutProps} />
    }
    if (variant === "tabs") {
      return <PassSystemTabsLayout {...layoutProps} />
    }
    return <PassSystemStackedLayout {...layoutProps} />
  }

  // ---------------------------------------------------------------------------
  // open-checkout / simple_quantity path — flat layout, actions via contract
  // ---------------------------------------------------------------------------
  // State (quantity/selection) now comes from the VM's synthetic bucket
  // (view.sections). Presentational config (image_url, image_aspect,
  // description) still comes from configSections (TicketCardSection).
  // The two are zipped by section key.

  const vmSectionsByKey = new Map(view.sections.map((s) => [s.key, s]))

  // Build open groups: config section drives layout/image; VM section drives rows.
  // Fall back to a single flat group when configSections is empty.
  const openGroups = configSections.length
    ? configSections
        .map((section) => ({
          section,
          rows: vmSectionsByKey.get(section.key)?.rows ?? [],
        }))
        .filter((g) => g.rows.length > 0)
    : view.sections.length
      ? view.sections.map((vmSection) => ({
          section: {
            key: vmSection.key,
            label: vmSection.label,
            order: 0,
            product_ids: vmSection.rows.map((r) => r.product.id),
          } as TicketCardSection,
          rows: vmSection.rows,
        }))
      : []

  if (openGroups.length === 0) {
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

  const openLayoutProps: OpenCheckoutLayoutProps = {
    groups: openGroups,
    surface,
    imageAspect,
    onToggle: view.toggleRow,
    onQuantityChange: view.setRowQuantity,
  }

  if (variant === "compact") {
    return <OpenCheckoutCompactLayout {...openLayoutProps} />
  }
  if (variant === "tabs") {
    return <OpenCheckoutTabsLayout {...openLayoutProps} />
  }
  return <OpenCheckoutStackedLayout {...openLayoutProps} />
}
