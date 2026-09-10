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
 * All three are a single choice, because the cart holds one room:
 * `addAccommodation` replaces rather than appends. So each room is a radio
 * and the card itself is the control, which is what took the Select button
 * off the screen. A button per room said "press me" a dozen times over and
 * made picking a room look like adding one to a basket you could keep
 * filling; a checked circle says the true thing, that choosing this room is
 * un-choosing the last one.
 *
 * Clicking the chosen room again lets it go. Strict radio behaviour would
 * keep it chosen, and that is the one deviation here: a room is not a
 * required answer, the step can be walked past without one, so the buyer has
 * to be able to get back to none. The alternative was a second control
 * saying Remove, which puts the way out somewhere other than where the way
 * in was.
 *
 * What none of these cards can do is make the case for its room. That is the
 * dialog's job, and every layout has the same way into it, bottom right,
 * where the price the buyer is reading about already is.
 *
 * Every price here is a server quote. Nightly rate times nights is wrong the
 * moment a date-range rule or the long-stay rate applies, so nothing on this
 * screen multiplies.
 */

import type { TFunction } from "i18next"
import { Check, Images, Users } from "lucide-react"
import Image from "next/image"
import type { KeyboardEvent, ReactNode } from "react"
import { useTranslation } from "react-i18next"
import type { PublicAccommodation } from "@/client"
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
  onOpenDetails: () => void
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
export function Price({
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
export function Scarcity({ entry }: { entry: BoardEntry }) {
  const { t } = useTranslation()
  const left = entry.availability.available
  if (left <= 0 || left > 3) return null
  return (
    <p className="text-xs text-amber-600">
      {t("checkout.accommodation.only_left", { count: left })}
    </p>
  )
}

/** The circle that says whether this is the room. */
function ChoiceMark({
  selected,
  className,
}: {
  selected: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/35 bg-background",
        className,
      )}
    >
      {selected && <Check className="h-3 w-3" />}
    </span>
  )
}

/**
 * A room, as one option among the rooms on offer.
 *
 * `role="radio"` rather than a `<button>` because the card has to contain a
 * button of its own, and a button inside a button is not something the
 * browser will render. Enter and Space do what a click does.
 */
function RoomChoice({
  selected,
  onSelect,
  onRemove,
  className,
  children,
}: Pick<RoomViewProps, "selected" | "onSelect" | "onRemove"> & {
  className?: string
  children: ReactNode
}) {
  const toggle = () => (selected ? onRemove() : onSelect())
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Only from the card surface itself. Enter on the Details button inside
    // it bubbles up here, and would otherwise book the room the buyer was
    // asking to read about.
    if (event.target !== event.currentTarget) return
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    toggle()
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: a real radio input cannot contain the button this card contains
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={toggle}
      onKeyDown={onKeyDown}
      className={cn(
        "cursor-pointer text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * The one thing a card does that is not "choose me".
 *
 * It stops the click reaching the card, which would otherwise book the room
 * the buyer only wanted to read about.
 */
function DetailsLink({
  onOpenDetails,
  className,
}: Pick<RoomViewProps, "onOpenDetails"> & { className?: string }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onOpenDetails()
      }}
      className={cn(
        "font-medium text-primary text-xs underline-offset-2 hover:underline",
        className,
      )}
    >
      {t("checkout.accommodation.view_details")}
    </button>
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

/** How many photos there are, printed on the one that is showing. */
function PhotoCount({ room }: { room: PublicAccommodation }) {
  const count = room.images?.length ?? 0
  if (count < 2) return null
  return (
    <span className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 font-medium text-[11px] text-white">
      <Images aria-hidden className="h-3 w-3" />
      {count}
    </span>
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
  onOpenDetails,
}: RoomViewProps) {
  const { room } = entry
  return (
    <RoomChoice
      selected={selected}
      onSelect={onSelect}
      onRemove={onRemove}
      className={cn(
        "flex flex-col gap-3 rounded-2xl border bg-card p-3 sm:flex-row",
        selected
          ? "border-primary ring-1 ring-primary"
          : "hover:border-primary/50",
      )}
    >
      <div className="relative h-32 w-full shrink-0 sm:h-auto sm:w-32">
        <Photo
          room={room}
          className="absolute inset-0 rounded-xl"
          sizes="(max-width: 640px) 100vw, 128px"
        />
        <PhotoCount room={room} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-2">
          <ChoiceMark selected={selected} className="mt-0.5" />
          <h4 className="font-semibold leading-tight">{room.name}</h4>
        </div>
        <RoomFacts room={room} />
        {room.description && (
          <p className="line-clamp-2 text-muted-foreground text-xs">
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
        <DetailsLink onOpenDetails={onOpenDetails} />
      </div>
    </RoomChoice>
  )
}

/**
 * Layout "cards": photo first, and the card itself is the control.
 *
 * The 4:3 photo is the whole reason to pick this layout, so everything else
 * is kept to what fits under it. Worth it only when the rooms are actually
 * photographed; without images it is a worse version of rows.
 */
export function RoomCard({
  entry,
  currency,
  nights,
  selected,
  onSelect,
  onRemove,
  onOpenDetails,
}: RoomViewProps) {
  const { t } = useTranslation()
  const { room } = entry
  return (
    <RoomChoice
      selected={selected}
      onSelect={onSelect}
      onRemove={onRemove}
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border bg-card",
        selected
          ? "border-primary ring-1 ring-primary"
          : "hover:border-primary/60",
      )}
    >
      <div className="relative aspect-[4/3] w-full">
        <Photo
          room={room}
          className="absolute inset-0"
          sizes="(max-width: 640px) 100vw, 50vw"
        />
        <PhotoCount room={room} />
        <ChoiceMark
          selected={selected}
          className="absolute top-2 right-2 h-6 w-6 shadow-sm"
        />
        {selected && (
          <span className="absolute top-2 left-2 rounded-full bg-primary px-2 py-0.5 font-medium text-[11px] text-primary-foreground">
            {t("checkout.accommodation.your_room")}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <h4 className="font-semibold leading-tight">{room.name}</h4>
        <RoomFacts room={room} />
        <Scarcity entry={entry} />
        <div className="mt-auto flex items-end justify-between gap-3 pt-2">
          <Price entry={entry} currency={currency} nights={nights} />
          <DetailsLink onOpenDetails={onOpenDetails} />
        </div>
      </div>
    </RoomChoice>
  )
}

/**
 * Layout "sheet": one line per room, for an offer with more room types than
 * fit a screen.
 *
 * The buyer here is scanning names and prices, so a line is a name, a price
 * and a thumbnail. It used to unfold in place instead, which meant the
 * description and the one photo it could fit were competing for width with
 * the list they were pushing apart. The dialog has neither problem, and it
 * is the same dialog the other two layouts open.
 */
export function RoomSheetRow({
  entry,
  currency,
  nights,
  selected,
  onSelect,
  onRemove,
  onOpenDetails,
}: RoomViewProps) {
  const { t } = useTranslation()
  const { room } = entry
  const beds = bedSummary(room, t)
  return (
    <RoomChoice
      selected={selected}
      onSelect={onSelect}
      onRemove={onRemove}
      className={cn(
        "flex items-center gap-3 border-b p-3 last:border-b-0",
        selected ? "bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <ChoiceMark selected={selected} />
      <Photo
        room={room}
        className="h-12 w-12 shrink-0 rounded-lg"
        sizes="48px"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{room.name}</p>
        <p className="truncate text-muted-foreground text-xs">
          {t("checkout.accommodation.sleeps", { count: room.guest_capacity })}
          {beds && ` · ${beds}`}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <Price
          entry={entry}
          currency={currency}
          nights={nights}
          align="right"
        />
        <DetailsLink onOpenDetails={onOpenDetails} />
      </div>
    </RoomChoice>
  )
}
