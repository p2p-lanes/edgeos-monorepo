"use client"

/**
 * The three ways a room can appear in the checkout.
 *
 * Same room, same facts, same actions: what changes is how much of the space
 * goes to the photo and how much to the price, which is the only thing that
 * separates an offer of four photographed suites from an offer of twenty
 * dorm beds. The step's `layout` picks one; none of them knows about the
 * others.
 *
 * Every price here is a server quote. Nightly rate times nights is wrong the
 * moment a date-range rule or the long-stay rate applies, so nothing on this
 * screen multiplies.
 */

import type { TFunction } from "i18next"
import { Check, ChevronRight, Users } from "lucide-react"
import Image from "next/image"
import { useTranslation } from "react-i18next"
import type { PublicAccommodation } from "@/client"
import { Button } from "@/components/ui/button"
import type { BoardEntry } from "@/lib/accommodationBoard"
import { imageOptimization } from "@/lib/image-optimization"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/types/checkout"

export interface RoomViewProps {
  entry: BoardEntry
  currency: string | undefined
  nights: number
  selected: boolean
  onSelect: () => void
  onRemove: () => void
}

export function bedSummary(room: PublicAccommodation, t: TFunction): string {
  const beds = room.beds ?? []
  if (beds.length === 0) return ""
  return beds
    .map((bed) =>
      t("checkout.accommodation.bed_count", {
        count: bed.count,
        type: t(`checkout.accommodation.bed_types.${bed.type}`),
      }),
    )
    .join(" · ")
}

/** Sleeps N, and what it sleeps them in. */
function RoomFacts({ room }: { room: PublicAccommodation }) {
  const { t } = useTranslation()
  const beds = bedSummary(room, t)
  return (
    <p className="text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1 align-middle">
        <Users className="h-3.5 w-3.5" />
        {t("checkout.accommodation.sleeps", { count: room.guest_capacity })}
      </span>
      {beds && <span> · {beds}</span>}
    </p>
  )
}

/**
 * What the stay costs, and what that price is made of.
 *
 * The total leads because it is the number the buyer is deciding on; the
 * night count under it is what stops the total from reading as a nightly
 * rate. No per-night figure is shown, because dividing the quote back out
 * would print a rate the property does not charge.
 */
function Price({
  entry,
  currency,
  nights,
  align,
}: Pick<RoomViewProps, "entry" | "currency" | "nights"> & {
  align?: "right"
}) {
  const { t } = useTranslation()
  const quote = entry.availability.quote
  if (!quote) return null
  const tax = Number(quote.tax)
  return (
    <div className={cn("flex flex-col", align === "right" && "items-end")}>
      <span className="text-lg font-semibold leading-tight">
        {formatCurrency(Number(quote.total), currency)}
      </span>
      <span className="text-xs text-muted-foreground">
        {t("checkout.accommodation.nights", { count: nights })}
        {quote.applied_rule === "long_stay" &&
          ` · ${t("checkout.accommodation.monthly_rate")}`}
      </span>
      {tax > 0 && (
        <span className="text-xs text-muted-foreground">
          {t("checkout.accommodation.includes_tax", {
            amount: formatCurrency(tax, currency),
          })}
        </span>
      )}
    </div>
  )
}

/** "Only 2 left", and only when it is true and low enough to matter. */
function Scarcity({ entry }: { entry: BoardEntry }) {
  const { t } = useTranslation()
  const left = entry.availability.available
  if (left <= 0 || left > 3) return null
  return (
    <p className="text-xs text-amber-600">
      {t("checkout.accommodation.only_left", { count: left })}
    </p>
  )
}

function SelectAction({
  selected,
  onSelect,
  onRemove,
  className,
}: Pick<RoomViewProps, "selected" | "onSelect" | "onRemove"> & {
  className?: string
}) {
  const { t } = useTranslation()
  return selected ? (
    <Button variant="outline" className={className} onClick={onRemove}>
      {t("checkout.accommodation.remove")}
    </Button>
  ) : (
    <Button className={className} onClick={onSelect}>
      {t("checkout.accommodation.select")}
    </Button>
  )
}

function Photo({
  room,
  className,
  sizes,
}: {
  room: PublicAccommodation
  className?: string
  sizes: string
}) {
  const cover = room.images?.[0]?.url
  if (!cover) return <div className={cn("bg-muted", className)} />
  return (
    <div className={cn("relative overflow-hidden", className)}>
      <Image
        src={cover}
        alt={room.name}
        fill
        sizes={sizes}
        className="object-cover"
        {...imageOptimization(cover)}
      />
    </div>
  )
}

/**
 * Layout "rows": a wide row per room, prices in a column down the right.
 *
 * The default, because aligning the prices is the whole job of this screen
 * and a right rail does it for free. It is also the only one of the three
 * that neither needs photography nor gives up on it.
 */
export function RoomRow({
  entry,
  currency,
  nights,
  selected,
  onSelect,
  onRemove,
}: RoomViewProps) {
  const { room } = entry
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-2xl border bg-card p-3 transition-colors sm:flex-row",
        selected && "border-primary ring-1 ring-primary",
      )}
    >
      <Photo
        room={room}
        className="h-32 w-full rounded-xl sm:h-auto sm:w-32 sm:shrink-0"
        sizes="(max-width: 640px) 100vw, 128px"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h4 className="font-semibold leading-tight">{room.name}</h4>
        <RoomFacts room={room} />
        {room.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {room.description}
          </p>
        )}
        <Scarcity entry={entry} />
      </div>

      <div className="flex shrink-0 items-end justify-between gap-3 sm:w-36 sm:flex-col sm:items-end sm:justify-between">
        <Price
          entry={entry}
          currency={currency}
          nights={nights}
          align="right"
        />
        <SelectAction
          selected={selected}
          onSelect={onSelect}
          onRemove={onRemove}
          className="w-auto sm:w-full"
        />
      </div>
    </div>
  )
}

/**
 * Layout "cards": photo first, and the card itself is the control.
 *
 * Taking the button out of every card is what buys the room for a 4:3 photo,
 * so the card carries `aria-pressed` and the tick is the feedback. Worth it
 * only when the rooms are actually photographed; without images it is a
 * worse version of rows.
 */
export function RoomCard({
  entry,
  currency,
  nights,
  selected,
  onSelect,
  onRemove,
}: RoomViewProps) {
  const { t } = useTranslation()
  const { room } = entry
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={selected ? onRemove : onSelect}
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border bg-card text-left transition-colors hover:border-primary/60",
        selected && "border-primary ring-1 ring-primary",
      )}
    >
      <div className="relative aspect-[4/3] w-full">
        <Photo
          room={room}
          className="absolute inset-0"
          sizes="(max-width: 640px) 100vw, 50vw"
        />
        <span
          aria-hidden
          className={cn(
            "absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border bg-card",
            selected && "border-primary bg-primary text-primary-foreground",
          )}
        >
          {selected && <Check className="h-3.5 w-3.5" />}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <h4 className="font-semibold leading-tight">{room.name}</h4>
        <RoomFacts room={room} />
        <div className="mt-auto pt-2">
          <Price entry={entry} currency={currency} nights={nights} />
        </div>
        <Scarcity entry={entry} />
        <span className="text-xs font-medium text-primary">
          {selected
            ? t("checkout.accommodation.in_cart")
            : t("checkout.accommodation.select")}
        </span>
      </div>
    </button>
  )
}

/**
 * Layout "sheet": one line per room, opening in place.
 *
 * For an offer with more room types than fit a screen, where the buyer is
 * scanning names and prices rather than looking at pictures. The photo and
 * the description are one click away instead of costing every room its own
 * card.
 */
export function RoomSheetRow({
  entry,
  currency,
  nights,
  selected,
  onSelect,
  onRemove,
  open,
  onToggle,
}: RoomViewProps & { open: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  const { room } = entry
  const quote = entry.availability.quote
  return (
    <div className={cn("border-b last:border-b-0", selected && "bg-primary/5")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted/50"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{room.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {t("checkout.accommodation.sleeps", { count: room.guest_capacity })}
            {bedSummary(room, t) && ` · ${bedSummary(room, t)}`}
          </span>
        </span>
        {selected && (
          <Check aria-hidden className="h-4 w-4 shrink-0 text-primary" />
        )}
        {quote && (
          <span className="shrink-0 font-semibold">
            {formatCurrency(Number(quote.total), currency)}
          </span>
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-3 px-3 pb-3 sm:flex-row">
          <Photo
            room={room}
            className="h-28 w-full rounded-xl sm:w-40 sm:shrink-0"
            sizes="(max-width: 640px) 100vw, 160px"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {room.description && (
              <p className="text-xs text-muted-foreground">
                {room.description}
              </p>
            )}
            <Price entry={entry} currency={currency} nights={nights} />
            <Scarcity entry={entry} />
            <SelectAction
              selected={selected}
              onSelect={onSelect}
              onRemove={onRemove}
              className="w-fit"
            />
          </div>
        </div>
      )}
    </div>
  )
}
