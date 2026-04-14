"use client"

import { Building2, Calendar, Check, Home } from "lucide-react"
import Image from "next/image"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import ExpandableDescription from "@/components/ui/ExpandableDescription"
import QuantitySelector, {
  supportsQuantitySelector,
} from "@/components/ui/QuantitySelector"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import {
  calculateNights,
  formatCheckoutDate,
  formatCurrency,
} from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"
import type { VariantProps } from "../registries/variantRegistry"

/* ── Section types & helpers ─────────────────────────────── */

interface TemplateSection {
  key: string
  label: string
  order: number
  product_ids: string[]
}

function parseSections(
  templateConfig: VariantProps["templateConfig"],
): TemplateSection[] {
  const raw = templateConfig?.sections
  if (!Array.isArray(raw) || raw.length === 0) return []
  return [...(raw as TemplateSection[])].sort((a, b) => a.order - b.order)
}

interface SectionGroup {
  section: TemplateSection
  products: ProductsPass[]
}

function buildHousingSectionGroups(
  products: ProductsPass[],
  sections: TemplateSection[],
): SectionGroup[] {
  if (sections.length === 0) {
    return [
      {
        section: { key: "__all", label: "", order: 0, product_ids: [] },
        products,
      },
    ]
  }

  const productMap = new Map(products.map((p) => [p.id, p]))

  return sections
    .map((section) => ({
      section,
      products: section.product_ids
        .map((id) => productMap.get(id))
        .filter(Boolean) as ProductsPass[],
    }))
    .filter((g) => g.products.length > 0)
}

function formatDateInput(date: Date): string {
  return date.toISOString().split("T")[0]
}

function parseDate(dateStr: string): Date {
  const ymd = dateStr.split("T")[0]
  return new Date(`${ymd}T00:00:00`)
}

/* ── Shared date picker section ───────────────────────────── */

function DatePickerSection({
  checkIn,
  checkOut,
  popupStart,
  popupEnd,
  nights,
  pricePerDay,
  onCheckInChange,
  onCheckOutChange,
}: {
  checkIn: Date
  checkOut: Date
  popupStart: Date
  popupEnd: Date
  nights: number
  pricePerDay: boolean
  onCheckInChange: (date: Date) => void
  onCheckOutChange: (date: Date) => void
}) {
  return (
    <div className="bg-card rounded-2xl shadow-sm border border-border p-4 overflow-hidden">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-foreground">
          {pricePerDay ? `${nights} night${nights !== 1 ? "s" : ""}: ` : ""}
          {formatCheckoutDate(formatDateInput(checkIn))} -{" "}
          {formatCheckoutDate(formatDateInput(checkOut))}
        </span>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <div className="flex-1 min-w-0">
          <label
            htmlFor="checkin-date"
            className="block text-xs text-muted-foreground mb-1 sm:hidden"
          >
            Check-in
          </label>
          <input
            id="checkin-date"
            type="date"
            value={formatDateInput(checkIn)}
            min={formatDateInput(popupStart)}
            max={formatDateInput(checkOut)}
            onChange={(e) => onCheckInChange(parseDate(e.target.value))}
            className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <span className="hidden sm:block self-center text-muted-foreground">to</span>
        <div className="flex-1 min-w-0">
          <label
            htmlFor="checkout-date"
            className="block text-xs text-muted-foreground mb-1 sm:hidden"
          >
            Check-out
          </label>
          <input
            id="checkout-date"
            type="date"
            value={formatDateInput(checkOut)}
            min={formatDateInput(checkIn)}
            max={formatDateInput(popupEnd)}
            onChange={(e) => onCheckOutChange(parseDate(e.target.value))}
            className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
    </div>
  )
}

/* ── Shared skip link ─────────────────────────────────────── */

function SkipLink({ onSkip }: { onSkip?: () => void }) {
  return (
    <div className="text-center py-2">
      <button
        type="button"
        onClick={onSkip}
        className="text-muted-foreground hover:text-foreground underline text-sm transition-colors"
      >
        Skip this step
      </button>
    </div>
  )
}

/* ── Card props shared by both variants ───────────────────── */

interface CardListProps {
  groups: SectionGroup[]
  nights: number
  pricePerDay: boolean
  selectedProductId: string | null
  onProductSelect: (productId: string) => void
  onSkip?: () => void
}

/* ── Section header ──────────────────────────────────────── */

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pb-1">
      <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
      <h3 className="text-sm font-semibold text-foreground">{label}</h3>
    </div>
  )
}

/* ── Compact card row (single product) ───────────────────── */

function CompactCard({
  product,
  nights,
  pricePerDay,
  isSelected,
  onSelect,
}: {
  product: ProductsPass
  nights: number
  pricePerDay: boolean
  isSelected: boolean
  onSelect: () => void
}) {
  const totalPrice = pricePerDay ? product.price * nights : product.price
  const compareTotal = product.compare_price
    ? pricePerDay
      ? product.compare_price * nights
      : product.compare_price
    : null

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full flex items-center gap-3 rounded-xl border-l-4 px-3 py-3 text-left transition-all",
        isSelected
          ? "border-l-primary bg-primary/10"
          : "border-l-border bg-card hover:bg-muted",
      )}
    >
      <div
        className={cn(
          "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
          isSelected
            ? "bg-primary border-primary"
            : "bg-card border-muted-foreground/40",
        )}
      >
        {isSelected && <Check className="w-3 h-3 text-white" />}
      </div>

      <div className="w-14 h-14 rounded-lg overflow-hidden bg-muted shrink-0 relative">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            className="object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Home className="w-5 h-5 text-muted-foreground/50" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-foreground truncate">
          {product.name}
        </p>
        {pricePerDay && (
          <p className="text-xs text-muted-foreground">
            {formatCurrency(product.price)}/night
          </p>
        )}
      </div>

      <div className="text-right shrink-0">
        {compareTotal && compareTotal > totalPrice && (
          <p className="text-xs text-muted-foreground line-through">
            {formatCurrency(compareTotal)}
          </p>
        )}
        <p
          className={cn(
            "font-bold text-sm",
            isSelected ? "text-primary" : "text-foreground",
          )}
        >
          {formatCurrency(totalPrice)}
        </p>
        <p className="text-xs text-muted-foreground">total</p>
      </div>
    </button>
  )
}

/* ── Grid card (single product) ──────────────────────────── */

function GridCard({
  product,
  nights,
  pricePerDay,
  isSelected,
  onSelect,
}: {
  product: ProductsPass
  nights: number
  pricePerDay: boolean
  isSelected: boolean
  onSelect: () => void
}) {
  const totalPrice = pricePerDay ? product.price * nights : product.price
  const compareTotal = product.compare_price
    ? pricePerDay
      ? product.compare_price * nights
      : product.compare_price
    : null

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative flex flex-col rounded-2xl border overflow-hidden text-left transition-all bg-card",
        isSelected
          ? "border-primary ring-2 ring-primary/20"
          : "border-border hover:border-muted-foreground/30",
      )}
    >
      {product.image_url ? (
        <div className="relative w-full aspect-[4/3] bg-muted">
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            className="object-cover"
          />
        </div>
      ) : (
        <div className="w-full aspect-[4/3] bg-gradient-to-br from-muted to-muted/60 flex items-center justify-center">
          <Home className="w-8 h-8 text-muted-foreground/50" />
        </div>
      )}

      {isSelected && (
        <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
          <Check className="w-3.5 h-3.5 text-white" />
        </div>
      )}

      <div className="p-3">
        <p className="font-semibold text-foreground text-sm leading-tight">
          {product.name}
        </p>
        {product.description && (
          <ExpandableDescription
            text={product.description}
            clamp={2}
            className="text-xs text-muted-foreground mt-1"
          />
        )}
        {pricePerDay && (
          <p className="text-xs text-muted-foreground mt-1">
            {formatCurrency(product.price)}/night
          </p>
        )}
        <div className="flex items-center justify-between mt-2">
          {compareTotal && compareTotal > totalPrice ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground line-through">
                {formatCurrency(compareTotal)}
              </span>
              <span className="font-bold text-green-600 text-sm">
                {formatCurrency(totalPrice)}
              </span>
            </div>
          ) : (
            <span
              className={cn(
                "font-bold text-sm",
                isSelected ? "text-primary" : "text-foreground",
              )}
            >
              {formatCurrency(totalPrice)}
            </span>
          )}
          <span
            className={cn(
              "text-xs px-2 py-0.5 rounded-full font-medium",
              isSelected
                ? "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground",
            )}
          >
            {isSelected ? "Selected" : "Select"}
          </span>
        </div>
      </div>
    </button>
  )
}

/* ── Default section card (groups products within one card) ─ */

function DefaultSectionCard({
  section,
  products,
  nights,
  pricePerDay,
  selectedProductId,
  onProductSelect,
}: {
  section: TemplateSection
  products: ProductsPass[]
  nights: number
  pricePerDay: boolean
  selectedProductId: string | null
  onProductSelect: (id: string) => void
}) {
  const heroImage = products.find((p) => p.image_url)?.image_url

  return (
    <div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden">
      {section.label && (
        <div className="relative h-28 sm:h-36 bg-gradient-to-br from-muted to-muted/60">
          {heroImage ? (
            <Image
              src={heroImage}
              alt={section.label}
              fill
              className="object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <Home className="w-10 h-10 text-muted-foreground/50" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4">
            <h3 className="font-bold text-base sm:text-lg text-white">
              {section.label}
            </h3>
          </div>
        </div>
      )}
      <div className="p-3 sm:p-4 space-y-2">
        {products.map((product) => {
          const isSelected = selectedProductId === product.id
          const totalPrice = pricePerDay
            ? product.price * nights
            : product.price
          const compareTotal = product.compare_price
            ? pricePerDay
              ? product.compare_price * nights
              : product.compare_price
            : null

          return (
            <button
              key={product.id}
              type="button"
              onClick={() => onProductSelect(product.id)}
              className={cn(
                "w-full flex items-center justify-between p-3 rounded-xl border-2 transition-all text-left",
                isSelected
                  ? "border-primary bg-primary/10"
                  : "border-border bg-muted hover:border-muted-foreground/30",
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={cn(
                    "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0",
                    isSelected
                      ? "border-primary bg-primary"
                      : "border-muted-foreground/40",
                  )}
                >
                  {isSelected && <Check className="w-3 h-3 text-white" />}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-foreground text-sm truncate">
                    {product.name}
                  </p>
                  {pricePerDay && (
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(product.price)}/night
                    </p>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0 ml-2">
                {compareTotal && compareTotal > totalPrice && (
                  <p className="text-xs text-muted-foreground line-through">
                    {formatCurrency(compareTotal)}
                  </p>
                )}
                <p
                  className={cn(
                    "font-bold text-sm",
                    isSelected ? "text-primary" : "text-foreground",
                  )}
                >
                  {formatCurrency(totalPrice)}
                </p>
                <p className="text-xs text-muted-foreground">total</p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── Variant: Default (grouped card per section) ─────────── */

function HousingDefault({
  groups,
  nights,
  pricePerDay,
  selectedProductId,
  onProductSelect,
  onSkip,
}: CardListProps) {
  return (
    <div className="space-y-5">
      {groups.map(({ section, products }) => (
        <DefaultSectionCard
          key={section.key}
          section={section}
          products={products}
          nights={nights}
          pricePerDay={pricePerDay}
          selectedProductId={selectedProductId}
          onProductSelect={onProductSelect}
        />
      ))}
      <SkipLink onSkip={onSkip} />
    </div>
  )
}

/* ── Showcase section card (premium hero layout) ─────────── */

function ShowcaseSectionCard({
  section,
  products,
  nights,
  pricePerDay,
  selectedProductId,
  onProductSelect,
}: {
  section: TemplateSection
  products: ProductsPass[]
  nights: number
  pricePerDay: boolean
  selectedProductId: string | null
  onProductSelect: (id: string) => void
}) {
  const heroImage = products.find((p) => p.image_url)?.image_url

  return (
    <div className="rounded-2xl overflow-hidden bg-card shadow-md border border-border">
      {heroImage ? (
        <div className="relative h-44 sm:h-56">
          <Image
            src={heroImage}
            alt={section.label || ""}
            fill
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/50" />
          {section.label && (
            <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <div className="w-1 h-6 rounded-full bg-white/80" />
                <h3 className="font-bold text-lg sm:text-xl text-white drop-shadow-sm">
                  {section.label}
                </h3>
              </div>
            </div>
          )}
        </div>
      ) : (
        section.label && (
          <div className="px-5 pt-5 pb-2">
            <div className="flex items-center gap-2">
              <div className="w-1 h-5 rounded-full bg-primary" />
              <h3 className="font-semibold text-base text-foreground">
                {section.label}
              </h3>
            </div>
          </div>
        )
      )}
      <div className="p-4 sm:p-5">
        <div className="space-y-3">
          {products.map((product) => {
            const isSelected = selectedProductId === product.id
            const totalPrice = pricePerDay
              ? product.price * nights
              : product.price
            const compareTotal = product.compare_price
              ? pricePerDay
                ? product.compare_price * nights
                : product.compare_price
              : null

            return (
              <button
                key={product.id}
                type="button"
                onClick={() => onProductSelect(product.id)}
                className={cn(
                  "w-full flex items-center gap-4 p-3.5 rounded-xl transition-all text-left",
                  isSelected
                    ? "bg-primary/10 ring-2 ring-primary"
                    : "bg-muted hover:bg-muted/80 ring-1 ring-border",
                )}
              >
                {product.image_url && (
                  <div className="w-16 h-16 rounded-lg overflow-hidden bg-muted shrink-0 relative">
                    <Image
                      src={product.image_url}
                      alt={product.name}
                      fill
                      className="object-cover"
                    />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground truncate">
                    {product.name}
                  </p>
                  {product.description && (
                    <ExpandableDescription
                      text={product.description}
                      clamp={2}
                      className="text-xs text-muted-foreground mt-0.5"
                    />
                  )}
                  {pricePerDay && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatCurrency(product.price)}/night
                    </p>
                  )}
                </div>

                <div className="text-right shrink-0">
                  {compareTotal && compareTotal > totalPrice && (
                    <p className="text-xs text-muted-foreground line-through">
                      {formatCurrency(compareTotal)}
                    </p>
                  )}
                  <p
                    className={cn(
                      "font-bold text-base",
                      isSelected ? "text-primary" : "text-foreground",
                    )}
                  >
                    {formatCurrency(totalPrice)}
                  </p>
                  <p className="text-xs text-muted-foreground">total</p>
                </div>

                <div
                  className={cn(
                    "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0",
                    isSelected
                      ? "border-primary bg-primary"
                      : "border-muted-foreground/40 bg-card",
                  )}
                >
                  {isSelected && <Check className="w-3 h-3 text-white" />}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ── Variant: Showcase (premium hero sections) ───────────── */

function HousingShowcase({
  groups,
  nights,
  pricePerDay,
  selectedProductId,
  onProductSelect,
  onSkip,
}: CardListProps) {
  return (
    <div className="space-y-6">
      {groups.map(({ section, products }) => (
        <ShowcaseSectionCard
          key={section.key}
          section={section}
          products={products}
          nights={nights}
          pricePerDay={pricePerDay}
          selectedProductId={selectedProductId}
          onProductSelect={onProductSelect}
        />
      ))}
      <SkipLink onSkip={onSkip} />
    </div>
  )
}

/* ── Variant: Compact (minimal horizontal rows) ───────────── */

function HousingCompact({
  groups,
  nights,
  pricePerDay,
  selectedProductId,
  onProductSelect,
  onSkip,
}: CardListProps) {
  return (
    <div className="space-y-4">
      {groups.map(({ section, products }) => (
        <div key={section.key} className="space-y-2">
          {section.label && <SectionHeader label={section.label} />}
          {products.map((product) => (
            <CompactCard
              key={product.id}
              product={product}
              nights={nights}
              pricePerDay={pricePerDay}
              isSelected={selectedProductId === product.id}
              onSelect={() => onProductSelect(product.id)}
            />
          ))}
        </div>
      ))}
      <SkipLink onSkip={onSkip} />
    </div>
  )
}

/* ── Variant: Grid (2-column gallery cards) ───────────────── */

function HousingGrid({
  groups,
  nights,
  pricePerDay,
  selectedProductId,
  onProductSelect,
  onSkip,
}: CardListProps) {
  return (
    <div className="space-y-6">
      {groups.map(({ section, products }) => (
        <div key={section.key} className="space-y-3">
          {section.label && <SectionHeader label={section.label} />}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {products.map((product) => (
              <GridCard
                key={product.id}
                product={product}
                nights={nights}
                pricePerDay={pricePerDay}
                isSelected={selectedProductId === product.id}
                onSelect={() => onProductSelect(product.id)}
              />
            ))}
          </div>
        </div>
      ))}
      <SkipLink onSkip={onSkip} />
    </div>
  )
}

/* ── Main export ──────────────────────────────────────────── */

/* ── Quantity summary (shown when a multi-unit housing is selected) ── */

function HousingQuantitySummary({
  product,
  quantity,
  totalPrice,
  onQuantityChange,
}: {
  product: ProductsPass
  quantity: number
  totalPrice: number
  onQuantityChange: (qty: number) => void
}) {
  const max = product.max_quantity ?? Number.POSITIVE_INFINITY
  return (
    <div className="bg-primary/10 border border-primary/20 rounded-2xl p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs text-primary uppercase font-semibold tracking-wide">
          {product.name}
        </p>
        <p className="text-sm text-foreground font-medium mt-0.5">
          {quantity} {quantity === 1 ? "unit" : "units"} ·{" "}
          {formatCurrency(totalPrice)}
        </p>
      </div>
      <QuantitySelector
        size="md"
        value={quantity}
        min={1}
        max={max}
        onIncrement={() => onQuantityChange(quantity + 1)}
        onDecrement={() => onQuantityChange(quantity - 1)}
      />
    </div>
  )
}

export default function VariantHousingDate({
  products,
  onSkip,
  templateConfig,
}: VariantProps) {
  const { cart, selectHousing, updateHousingQuantity, clearHousing } =
    useCheckout()
  const { getCity } = useCityProvider()
  const city = getCity()

  const popupStart = useMemo(() => {
    if (city?.start_date) return parseDate(city.start_date)
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  }, [city?.start_date])

  const popupEnd = useMemo(() => {
    if (city?.end_date) return parseDate(city.end_date)
    return new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
  }, [city?.end_date])

  const [checkIn, setCheckIn] = useState<Date>(
    cart.housing?.checkIn ? new Date(cart.housing.checkIn) : popupStart,
  )
  const [checkOut, setCheckOut] = useState<Date>(
    cart.housing?.checkOut ? new Date(cart.housing.checkOut) : popupEnd,
  )
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    cart.housing?.productId || null,
  )

  const nights = calculateNights(
    formatDateInput(checkIn),
    formatDateInput(checkOut),
  )

  useEffect(() => {
    if (selectedProductId) {
      selectHousing(
        selectedProductId,
        formatDateInput(checkIn),
        formatDateInput(checkOut),
      )
    }
  }, [selectedProductId, checkIn, checkOut, selectHousing])

  const handleProductSelect = (productId: string) => {
    if (selectedProductId === productId) {
      setSelectedProductId(null)
      clearHousing()
    } else {
      setSelectedProductId(productId)
    }
  }

  const handleSkip = () => {
    setSelectedProductId(null)
    clearHousing()
    onSkip?.()
  }

  const sections = useMemo(
    () => parseSections(templateConfig),
    [templateConfig],
  )
  const groups = useMemo(
    () => buildHousingSectionGroups(products, sections),
    [products, sections],
  )

  const totalProducts = groups.reduce((n, g) => n + g.products.length, 0)

  if (totalProducts === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Home className="w-12 h-12 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">
          No Housing Available
        </h3>
        <p className="text-muted-foreground max-w-md mb-6">
          Housing options are not currently available for this event. You can
          continue to the next step.
        </p>
        <Button variant="outline" onClick={handleSkip}>
          Continue without housing
        </Button>
      </div>
    )
  }

  const variant = (templateConfig?.variant as string) || "default"
  const showDates = templateConfig?.show_dates !== false
  // When dates are hidden, per-night pricing becomes meaningless — collapse
  // the totals to flat product.price so all card components render consistently.
  const pricePerDay = showDates && templateConfig?.price_per_day !== false

  const cardProps: CardListProps = {
    groups,
    nights,
    pricePerDay,
    selectedProductId,
    onProductSelect: handleProductSelect,
    onSkip: handleSkip,
  }

  const VARIANT_MAP: Record<string, typeof HousingDefault> = {
    default: HousingDefault,
    compact: HousingCompact,
    grid: HousingGrid,
    showcase: HousingShowcase,
  }
  const VariantLayout = VARIANT_MAP[variant] ?? HousingDefault

  const selectedHousing =
    selectedProductId && cart.housing?.productId === selectedProductId
      ? cart.housing
      : null
  const canShowStepper =
    selectedHousing != null &&
    supportsQuantitySelector(selectedHousing.product.max_quantity)

  return (
    <div className="space-y-6">
      {showDates && (
        <DatePickerSection
          checkIn={checkIn}
          checkOut={checkOut}
          popupStart={popupStart}
          popupEnd={popupEnd}
          nights={nights}
          pricePerDay={pricePerDay}
          onCheckInChange={setCheckIn}
          onCheckOutChange={setCheckOut}
        />
      )}
      {canShowStepper && selectedHousing && (
        <HousingQuantitySummary
          product={selectedHousing.product}
          quantity={selectedHousing.quantity}
          totalPrice={selectedHousing.totalPrice}
          onQuantityChange={(qty) => {
            if (qty <= 0) {
              setSelectedProductId(null)
              clearHousing()
              return
            }
            updateHousingQuantity(qty)
          }}
        />
      )}
      <VariantLayout {...cardProps} />
    </div>
  )
}
