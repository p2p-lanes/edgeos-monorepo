"use client"

/**
 * Amanita skin — catalog product cards (Tickets / Alojamiento / Extras)
 * driven by the REAL `useTicketsStep` contract.
 *
 * Ported from checkout-amanita/codigo/checkout/sections.tsx
 * (`CatalogSectionView`, `ProductCard`, `VariantRow`, `clusterByCategory`) —
 * cream card, side/top product image, "Ver más/menos" description toggle,
 * per-row ± stepper, category cluster headings. Unlike the mockup (which
 * owns a local `cart: Record<string, number>` + `onInc`/`onDec` over a
 * static product catalog), this component resolves its products via
 * `useCheckout().getProductsForStep(stepConfig)` — the same call
 * DynamicProductStep.tsx makes — and feeds them into the REAL
 * `useTicketsStep` contract, so all stock / sale-state / max-quantity /
 * cart-sync logic is reused from the shared hook. This component only
 * supplies presentation.
 *
 * Adaptations vs the brief (see task-11-report.md for detail):
 * - `TicketRowVM` (the hook's real row shape) has no `attendeeId` field —
 *   the brief assumed `row.attendeeId`. The real open-checkout path
 *   (`useTicketsStep`'s `openCheckoutVMs` branch, mirrored by
 *   VariantTicketSelect's `OpenCheckoutRow`) always calls
 *   `setRowQuantity`/`toggleRow` with `""` as the attendee id for the
 *   simple_quantity / no-real-attendee path Amanita uses exclusively, so
 *   `OPEN_CHECKOUT_ATTENDEE_ID` below reproduces that real convention.
 * - `TicketSectionVM` has no `category` field for `clusterByCategory` to
 *   read (the hook currently never populates one). Category is instead
 *   read directly from the raw `template_config.sections[].category`
 *   (an optional field the typed `TemplateSection` shape doesn't declare)
 *   and correlated back to each section VM by `.key`.
 * - `TicketSectionVM.image_url`/`.description` are typed but never
 *   populated by the hook today, so the card image/description fall back
 *   to the first row's `product.image_url`/`product.description` — the
 *   field the brief explicitly named ("next/image for `product.image_url`").
 */
import Image from "next/image"
import { Fragment, useState } from "react"
import type { TicketingStepPublic } from "@/client"
import {
  type TicketRowVM,
  type TicketSectionVM,
  useTicketsStep,
} from "@/hooks/checkout/useTicketsStep"
import { imageOptimization } from "@/lib/image-optimization"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import { formatCurrency } from "@/types/checkout"
import type { GemVariant } from "./Gem"
import { GoldStar } from "./GoldStar"
import { SectionShell } from "./SectionShell"

const CREAM_CARD_STYLE = {
  border: "1px solid rgba(193,170,136,0.4)",
  boxShadow: "0 18px 48px rgba(1,15,22,0.5)",
} as const

const ROW_BORDER = "rgba(4,34,49,0.12)"
const DESC_COLOR = "#4a6670"

/** See the file-header adaptation note: TicketRowVM carries no attendeeId,
 * so this reproduces the real open-checkout convention (empty-string id)
 * used by useTicketsStep's simple_quantity branch and by
 * VariantTicketSelect's OpenCheckoutRow. */
const OPEN_CHECKOUT_ATTENDEE_ID = ""

// ---------------------------------------------------------------------------
// Category clustering (see adaptation note above)
// ---------------------------------------------------------------------------

function readSectionCategories(
  templateConfig: Record<string, unknown> | null | undefined,
): Map<string, string> {
  const raw = templateConfig?.sections
  const map = new Map<string, string>()
  if (!Array.isArray(raw)) return map
  for (const entry of raw as Array<Record<string, unknown>>) {
    const key = typeof entry?.key === "string" ? entry.key : null
    const category = typeof entry?.category === "string" ? entry.category : null
    if (key && category) map.set(key, category)
  }
  return map
}

interface SectionCluster {
  category?: string
  sections: TicketSectionVM[]
}

/** Groups contiguous sections sharing the same resolved category under one
 * cluster (mirrors the mockup's `clusterByCategory`, keyed by section.key
 * instead of a ProductGroup.category field that doesn't exist on the real
 * VM). Sections without a resolved category get their own headerless
 * cluster — Tickets/Alojamiento are unaffected. */
function clusterSectionsByCategory(
  sections: TicketSectionVM[],
  categoryBySectionKey: Map<string, string>,
): SectionCluster[] {
  const clusters: SectionCluster[] = []
  for (const section of sections) {
    const category = categoryBySectionKey.get(section.key)
    const last = clusters[clusters.length - 1]
    if (last && last.category === category) {
      last.sections.push(section)
    } else {
      clusters.push({ category, sections: [section] })
    }
  }
  return clusters
}

// ---------------------------------------------------------------------------
// VariantRow — per-product ± stepper / Add toggle
// ---------------------------------------------------------------------------

function VariantRow({
  row,
  onInc,
  onDec,
  onAdd,
}: {
  row: TicketRowVM
  onInc: () => void
  onDec: () => void
  onAdd: () => void
}) {
  const { product, quantity, disabled, usesStepper, maxQuantity, selected } =
    row
  const incDisabled = disabled || quantity >= maxQuantity

  return (
    <div
      className="flex items-center justify-between gap-3 border-t py-3.5 md:py-3"
      style={{ borderColor: ROW_BORDER }}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-snug text-deep">
          {product.name}
        </p>
        <p className="mt-0.5 font-condensed text-lg leading-none text-primary">
          {formatCurrency(product.price)}
        </p>
      </div>

      {usesStepper ? (
        quantity === 0 ? (
          <button
            type="button"
            aria-label={`Agregar ${product.name}`}
            onClick={onInc}
            disabled={incDisabled}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-xl leading-none text-cream transition-colors hover:bg-deep disabled:cursor-not-allowed disabled:opacity-40"
          >
            +
          </button>
        ) : (
          <div
            className="flex shrink-0 items-center gap-0.5 rounded-full border p-1"
            style={{
              borderColor: "rgba(0,74,90,0.35)",
              backgroundColor: "rgba(10,155,155,0.1)",
            }}
          >
            <button
              type="button"
              aria-label={`Quitar uno de ${product.name}`}
              onClick={onDec}
              disabled={disabled}
              className="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none text-primary transition-colors hover:bg-primary hover:text-cream disabled:cursor-not-allowed disabled:opacity-40"
            >
              −
            </button>
            <span className="min-w-7 text-center font-condensed text-base font-medium text-deep">
              {quantity}
            </span>
            <button
              type="button"
              aria-label={`Agregar uno más de ${product.name}`}
              onClick={onInc}
              disabled={incDisabled}
              className="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none text-primary transition-colors hover:bg-primary hover:text-cream disabled:cursor-not-allowed disabled:opacity-40"
            >
              +
            </button>
          </div>
        )
      ) : (
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          aria-pressed={selected}
          className={cn(
            "shrink-0 rounded-full px-5 py-2 font-condensed text-xs font-medium uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            selected
              ? "border text-primary"
              : "bg-primary text-cream hover:bg-deep",
          )}
          style={
            selected
              ? {
                  borderColor: "rgba(0,74,90,0.35)",
                  backgroundColor: "rgba(10,155,155,0.1)",
                }
              : undefined
          }
        >
          {selected ? "Agregado" : "Agregar"}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ProductCard — one per section VM
// ---------------------------------------------------------------------------

function ProductCard({
  section,
  onIncRow,
  onDecRow,
  onAddRow,
}: {
  section: TicketSectionVM
  onIncRow: (row: TicketRowVM) => void
  onDecRow: (row: TicketRowVM) => void
  onAddRow: (row: TicketRowVM) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const primaryProduct = section.rows[0]?.product
  const image = section.image_url ?? primaryProduct?.image_url ?? null
  const description = section.description ?? primaryProduct?.description ?? null

  return (
    <article
      className="overflow-hidden rounded-2xl bg-cream text-left md:flex"
      style={CREAM_CARD_STYLE}
    >
      {image && (
        <div
          className="aspect-[16/9] overflow-hidden md:aspect-auto md:w-[40%] md:shrink-0"
          style={{ backgroundColor: "#0a1424" }}
        >
          <Image
            src={image}
            alt={section.label}
            width={640}
            height={360}
            loading="lazy"
            className="h-full w-full object-cover"
            {...imageOptimization(image)}
          />
        </div>
      )}
      <div className="p-5 md:min-w-0 md:flex-1">
        <h3 className="font-display text-xl uppercase leading-tight tracking-wide text-deep">
          {section.label}
        </h3>
        {description && (
          <>
            <p
              className={cn(
                "mt-2 whitespace-pre-line text-sm leading-relaxed",
                expanded ? "" : "line-clamp-3 md:line-clamp-2",
              )}
              style={{ color: DESC_COLOR }}
            >
              {description}
            </p>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="mt-2 font-condensed text-xs font-medium uppercase tracking-[0.14em] text-primary underline underline-offset-4 transition-colors hover:text-accent"
            >
              {expanded ? "Ver menos" : "Ver más"}
            </button>
          </>
        )}
        <div className="mt-4 md:mt-3">
          {section.rows.map((row) => (
            <VariantRow
              key={row.product.id}
              row={row}
              onInc={() => onIncRow(row)}
              onDec={() => onDecRow(row)}
              onAdd={() => onAddRow(row)}
            />
          ))}
        </div>
      </div>
    </article>
  )
}

// ---------------------------------------------------------------------------
// AmanitaCatalogSection
// ---------------------------------------------------------------------------

export interface AmanitaCatalogSectionProps {
  stepConfig: TicketingStepPublic
  /** Gem separator variant for this step's SectionShell — the routing task
   * (Task 12) decides which gem each step type gets; defaults to "mid" so
   * this component is usable standalone. */
  gem?: GemVariant
}

export default function AmanitaCatalogSection({
  stepConfig,
  gem = "mid",
}: AmanitaCatalogSectionProps) {
  const { getProductsForStep } = useCheckout()
  const products = getProductsForStep(stepConfig)
  const templateConfig =
    (stepConfig.template_config as
      | Record<string, unknown>
      | null
      | undefined) ?? null

  const view = useTicketsStep({
    stepType: stepConfig.step_type,
    templateConfig,
    products,
  })

  const categoryBySectionKey = readSectionCategories(templateConfig)
  const clusters = clusterSectionsByCategory(
    view.sections,
    categoryBySectionKey,
  )

  // Task 12 review fix: SectionShell's `kicker` used to be bound to the same
  // `stepConfig.title` as `title`, duplicating the text visually. Prefer a
  // distinct `template_config.kicker` string, else fall back to the step's
  // `watermark`, else omit the kicker entirely rather than repeat the title.
  const templateKicker =
    typeof templateConfig?.kicker === "string" ? templateConfig.kicker : null
  const kicker = templateKicker ?? stepConfig.watermark ?? undefined

  const handleInc = (row: TicketRowVM) => {
    view.setRowQuantity(
      OPEN_CHECKOUT_ATTENDEE_ID,
      row.product,
      Math.min(row.quantity + 1, row.maxQuantity),
    )
  }
  const handleDec = (row: TicketRowVM) => {
    view.setRowQuantity(
      OPEN_CHECKOUT_ATTENDEE_ID,
      row.product,
      Math.max(row.quantity - 1, 0),
    )
  }
  const handleAdd = (row: TicketRowVM) => {
    view.toggleRow(OPEN_CHECKOUT_ATTENDEE_ID, row.product)
  }

  return (
    <SectionShell
      gem={gem}
      kicker={kicker}
      title={stepConfig.title}
      intro={stepConfig.description ?? undefined}
    >
      {clusters.map((cluster, idx) => (
        <Fragment key={cluster.sections[0]?.key ?? idx}>
          {cluster.category && (
            <div className="-mb-2 flex items-center justify-center gap-2.5">
              <GoldStar className="h-3 w-3" />
              <h3 className="font-display text-lg uppercase tracking-wide text-cream md:text-xl">
                {cluster.category}
              </h3>
              <GoldStar className="h-3 w-3" />
            </div>
          )}
          {cluster.sections.map((section) => (
            <ProductCard
              key={section.key}
              section={section}
              onIncRow={handleInc}
              onDecRow={handleDec}
              onAddRow={handleAdd}
            />
          ))}
        </Fragment>
      ))}
    </SectionShell>
  )
}
