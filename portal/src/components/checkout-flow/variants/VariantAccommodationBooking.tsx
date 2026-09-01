"use client"

/**
 * The accommodation checkout step.
 *
 * Reads nothing from `products`: rooms are not products the buyer browses,
 * they are inventory that only means anything once dates exist. So the step
 * asks for dates first, then asks the server what is free and what it costs,
 * and only then shows cards. Every price on this screen is a server quote:
 * nightly rate times nights is wrong as soon as a date-range rule or the
 * long-stay rate applies, so the client never multiplies.
 *
 * `template_config` governs presentation only (`layout`,
 * `show_property_headers`, `require_guest_names`, `notice_text`). Which
 * properties are on offer is enforced by the backend, which filters both
 * endpoints by the step's subset. The client could not be trusted with that
 * and is not asked to be.
 */

import { useQuery } from "@tanstack/react-query"
import { BedDouble, Check, Info, Loader2, Users } from "lucide-react"
import Image from "next/image"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  type AccommodationOffer,
  AccommodationsService,
  CheckoutService,
  type PublicAccommodation,
  type PublicAccommodationAvailability,
} from "@/client"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { imageOptimization } from "@/lib/image-optimization"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import {
  calculateNights,
  formatCheckoutDate,
  formatCurrency,
  type SelectedAccommodationItem,
} from "@/types/checkout"
import type { VariantProps } from "../registries/variantRegistry"

const DEFAULT_NOTICE =
  "Accommodation is paid in full at checkout and is non-refundable."

interface AccommodationTemplateConfig {
  layout: "grid" | "list"
  showPropertyHeaders: boolean
  requireGuestNames: boolean
  noticeText: string
}

function parseConfig(
  raw: VariantProps["templateConfig"],
): AccommodationTemplateConfig {
  const config = (raw ?? {}) as Record<string, unknown>
  return {
    layout: config.layout === "list" ? "list" : "grid",
    showPropertyHeaders: config.show_property_headers !== false,
    requireGuestNames: config.require_guest_names !== false,
    noticeText:
      typeof config.notice_text === "string" && config.notice_text.trim()
        ? config.notice_text
        : DEFAULT_NOTICE,
  }
}

function toDateInput(date: Date): string {
  // Local calendar parts, not toISOString(): the picker hands back local
  // midnights, and their UTC rendering falls a day earlier east of UTC.
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function addDays(value: string, amount: number): string {
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year, month - 1, day + amount)
  return toDateInput(date)
}

/** The union of every room's bookable window: the outer bounds of the picker. */
function bookableBounds(rooms: PublicAccommodation[]): {
  from: string | null
  to: string | null
} {
  if (rooms.length === 0) return { from: null, to: null }
  return {
    from: rooms.reduce(
      (min, room) => (room.bookable_from < min ? room.bookable_from : min),
      rooms[0].bookable_from,
    ),
    to: rooms.reduce(
      (max, room) => (room.bookable_to > max ? room.bookable_to : max),
      rooms[0].bookable_to,
    ),
  }
}

function bedSummary(room: PublicAccommodation): string {
  const beds = room.beds ?? []
  if (beds.length === 0) return ""
  return beds
    .map(
      (bed) => `${bed.count} ${bed.type.replace(/^./, (c) => c.toUpperCase())}`,
    )
    .join(" · ")
}

/**
 * Why a room cannot be booked, in words the buyer can act on.
 *
 * The codes are the backend's stable `REASON_*` strings; an unrecognised one
 * degrades to a neutral sentence rather than showing a raw identifier.
 */
function unavailableCopy(reason: string | null | undefined): string | null {
  switch (reason) {
    case null:
    case undefined:
      return null
    case "sold_out":
      return "Fully booked for these dates"
    case "min_stay_not_met":
      return "Needs a longer stay"
    case "outside_bookable_window":
      return "Not available on these dates"
    case "over_capacity":
      return "Too small for your party"
    case "inactive":
      return "Not available"
    default:
      return "Not available for these dates"
  }
}

interface RoomCardProps {
  room: PublicAccommodation
  availability: PublicAccommodationAvailability | undefined
  currency: string | undefined
  selected: SelectedAccommodationItem | undefined
  nights: number
  isPending: boolean
  onSelect: () => void
  onRemove: () => void
}

function RoomCard({
  room,
  availability,
  currency,
  selected,
  nights,
  isPending,
  onSelect,
  onRemove,
}: RoomCardProps) {
  const cover = room.images?.[0]?.url
  const quote = availability?.quote
  const blocked = unavailableCopy(availability?.unavailable_reason)
  const beds = bedSummary(room)

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border bg-card transition-colors",
        selected && "border-primary ring-1 ring-primary",
        blocked && !selected && "opacity-60",
      )}
    >
      {cover && (
        <div className="relative h-40 w-full">
          <Image
            src={cover}
            alt={room.name}
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover"
            {...imageOptimization(cover)}
          />
        </div>
      )}

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-semibold leading-tight">{room.name}</h4>
          {selected && (
            <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
              <Check className="h-3.5 w-3.5" />
              In cart
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            Sleeps {room.guest_capacity}
          </span>
          {beds && (
            <span className="flex items-center gap-1">
              <BedDouble className="h-3.5 w-3.5" />
              {beds}
            </span>
          )}
        </div>

        {room.description && (
          <p className="text-sm text-muted-foreground">{room.description}</p>
        )}

        <div className="mt-auto pt-3">
          {quote ? (
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-lg font-semibold">
                {formatCurrency(Number(quote.total), currency)}
              </span>
              <span className="text-xs text-muted-foreground">
                {nights} night{nights === 1 ? "" : "s"}
                {quote.applied_rule === "long_stay" && " · monthly rate"}
              </span>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">
              {formatCurrency(Number(room.default_nightly_price), currency)} /
              night
            </span>
          )}

          {quote && Number(quote.tax) > 0 && (
            <p className="text-xs text-muted-foreground">
              Includes {formatCurrency(Number(quote.tax), currency)} lodging tax
            </p>
          )}

          <div className="mt-3">
            {selected ? (
              <Button variant="outline" className="w-full" onClick={onRemove}>
                Remove
              </Button>
            ) : (
              <Button
                className="w-full"
                disabled={!!blocked || isPending || !quote}
                onClick={onSelect}
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  (blocked ?? "Select")
                )}
              </Button>
            )}
          </div>

          {availability &&
            availability.available > 0 &&
            availability.available <= 3 && (
              <p className="mt-2 text-center text-xs text-amber-600">
                Only {availability.available} left
              </p>
            )}
        </div>
      </div>
    </div>
  )
}

/** The party in one booked room: how many, and who. */
function GuestBlock({
  item,
  room,
  requireGuestNames,
}: {
  item: SelectedAccommodationItem
  room: PublicAccommodation | undefined
  requireGuestNames: boolean
}) {
  const { setAccommodationGuestCount, setAccommodationGuestName } =
    useCheckout()
  const capacity = room?.guest_capacity ?? item.guestCount

  return (
    <div className="rounded-xl border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">{item.name}</p>
          <p className="text-xs text-muted-foreground">
            {item.propertyName} · {formatCheckoutDate(item.checkIn)} →{" "}
            {formatCheckoutDate(item.checkOut)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`guests-${item.accommodationId}`} className="text-xs">
            Guests
          </Label>
          <Input
            id={`guests-${item.accommodationId}`}
            type="number"
            min={1}
            max={capacity}
            className="w-20"
            value={item.guestCount}
            onChange={(event) =>
              setAccommodationGuestCount(
                item.accommodationId,
                item.checkIn,
                item.checkOut,
                Number(event.target.value) || 1,
              )
            }
          />
        </div>
      </div>

      {requireGuestNames && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {item.guests.map((guest, index) => (
            <Input
              // Positional slots: a guest has no id until the booking exists,
              // and this UI never reorders them.
              key={index}
              placeholder={`Guest ${index + 1} full name`}
              value={guest}
              onChange={(event) =>
                setAccommodationGuestName(
                  item.accommodationId,
                  item.checkIn,
                  item.checkOut,
                  index,
                  event.target.value,
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function VariantAccommodationBooking({
  templateConfig,
  onSkip,
}: VariantProps) {
  const { t } = useTranslation()
  const { getCity } = useCityProvider()
  const {
    cart,
    addAccommodation,
    removeAccommodation,
    clearAccommodationsOutsideStay,
    previewToken,
    submitMode,
  } = useCheckout()

  const config = useMemo(() => parseConfig(templateConfig), [templateConfig])
  const city = getCity()
  const slug = city?.slug ?? ""
  const popupId = city?.id ?? ""
  const currency = city?.currency ?? undefined

  // Two doors to the same inventory. The anonymous endpoints only serve
  // `sale_type=direct` popups; an application popup's rooms live behind the
  // logged-in portal ones, exactly as its products do.
  const isOpenCheckout = submitMode === "open-ticketing"
  const canFetch = isOpenCheckout ? !!slug : !!popupId

  const { data: offer, isLoading: offerLoading } = useQuery<AccommodationOffer>(
    {
      queryKey: [
        "checkout-accommodations",
        submitMode,
        slug,
        popupId,
        previewToken,
      ],
      queryFn: () =>
        isOpenCheckout
          ? CheckoutService.listCheckoutAccommodations({
              slug,
              xCheckoutPreviewToken: previewToken ?? undefined,
            })
          : AccommodationsService.listPortalAccommodations({ popupId }),
      enabled: canFetch,
      staleTime: 60_000,
      // A popup with the step turned off answers 404; retrying will not change
      // its mind, and the step renders its empty state instead.
      retry: false,
    },
  )

  const rooms = useMemo(() => offer?.accommodations ?? [], [offer])
  const bounds = useMemo(() => bookableBounds(rooms), [rooms])

  const [checkIn, setCheckIn] = useState("")
  const [checkOut, setCheckOut] = useState("")

  /**
   * The shortest stay that any room here accepts.
   *
   * Seeding one night would open the step on "Needs a longer stay" wherever a
   * minimum is configured, and the buyer would have to guess that the fix is to
   * push check-out out, before ever seeing a price.
   */
  const shortestStay = useMemo(
    () =>
      rooms.reduce(
        (min, room) => Math.min(min, Math.max(1, room.min_stay)),
        Number.POSITIVE_INFINITY,
      ),
    [rooms],
  )

  // Seed the dates from the earliest bookable day once the inventory lands,
  // so the buyer sees prices instead of an empty screen with two pickers.
  useEffect(() => {
    if (checkIn || !bounds.from) return
    const nights = Number.isFinite(shortestStay) ? shortestStay : 1
    const seeded = addDays(bounds.from, nights)
    setCheckIn(bounds.from)
    // Never seed past the last bookable day, even when the minimum stay does
    // not fit the window; the server would only answer "outside the window".
    setCheckOut(bounds.to && seeded > bounds.to ? bounds.to : seeded)
  }, [bounds.from, bounds.to, checkIn, shortestStay])

  const nights = checkIn && checkOut ? calculateNights(checkIn, checkOut) : 0
  const datesReady = !!checkIn && !!checkOut && checkOut > checkIn

  const { data: availability, isFetching: availabilityFetching } = useQuery<
    PublicAccommodationAvailability[]
  >({
    queryKey: [
      "checkout-accommodation-availability",
      submitMode,
      slug,
      popupId,
      checkIn,
      checkOut,
    ],
    queryFn: () =>
      isOpenCheckout
        ? CheckoutService.checkAccommodationAvailability({
            slug,
            xCheckoutPreviewToken: previewToken ?? undefined,
            requestBody: { check_in: checkIn, check_out: checkOut },
          })
        : AccommodationsService.checkPortalAccommodationAvailability({
            popupId,
            requestBody: { check_in: checkIn, check_out: checkOut },
          }),
    enabled: canFetch && datesReady,
    staleTime: 30_000,
    retry: false,
  })

  const availabilityById = useMemo(
    () =>
      new Map((availability ?? []).map((row) => [row.accommodation_id, row])),
    [availability],
  )

  const propertyById = useMemo(
    () => new Map((offer?.properties ?? []).map((row) => [row.id, row])),
    [offer],
  )

  const roomById = useMemo(
    () => new Map(rooms.map((room) => [room.id, room])),
    [rooms],
  )

  const selectedByRoom = useMemo(
    () =>
      new Map(cart.accommodations.map((item) => [item.accommodationId, item])),
    [cart.accommodations],
  )

  // Moving the stay invalidates every quote in the cart, so the rooms booked
  // for the old nights go with it rather than being silently re-priced.
  const applyStay = (nextIn: string, nextOut: string) => {
    setCheckIn(nextIn)
    setCheckOut(nextOut)
    clearAccommodationsOutsideStay(nextIn, nextOut)
  }

  const grouped = useMemo(() => {
    const byProperty = new Map<string, PublicAccommodation[]>()
    for (const room of rooms) {
      const list = byProperty.get(room.property_id) ?? []
      list.push(room)
      byProperty.set(room.property_id, list)
    }
    return [...byProperty.entries()].map(([propertyId, list]) => ({
      property: propertyById.get(propertyId),
      rooms: list,
    }))
  }, [rooms, propertyById])

  const handleSelect = (room: PublicAccommodation) => {
    const row = availabilityById.get(room.id)
    if (!row?.quote || !room.product_id) return
    const property = propertyById.get(room.property_id)
    addAccommodation({
      accommodationId: room.id,
      productId: room.product_id,
      name: room.name,
      propertyId: room.property_id,
      propertyName: property?.name ?? "",
      checkIn,
      checkOut,
      nights,
      guestCount: 1,
      guests: [""],
      subtotal: Number(row.quote.subtotal),
      tax: Number(row.quote.tax),
      totalPrice: Number(row.quote.total),
      imageUrl: room.images?.[0]?.url ?? null,
    })
  }

  if (offerLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (rooms.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="mb-6 text-gray-500">{t("checkout.no_products")}</p>
        <Button variant="outline" onClick={onSkip}>
          {t("common.continue")}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stay-check-in">Check-in</Label>
            <DatePicker
              id="stay-check-in"
              value={checkIn}
              onChange={(value) =>
                applyStay(
                  value,
                  checkOut && checkOut > value ? checkOut : addDays(value, 1),
                )
              }
              disabledDays={(day) => {
                const key = toDateInput(day)
                return (
                  (!!bounds.from && key < bounds.from) ||
                  (!!bounds.to && key >= bounds.to)
                )
              }}
              defaultMonth={bounds.from ? new Date(bounds.from) : undefined}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stay-check-out">Check-out</Label>
            <DatePicker
              id="stay-check-out"
              value={checkOut}
              onChange={(value) => applyStay(checkIn, value)}
              disabledDays={(day) => {
                const key = toDateInput(day)
                return (
                  (!!checkIn && key <= checkIn) ||
                  (!!bounds.to && key > bounds.to)
                )
              }}
              defaultMonth={checkIn ? new Date(checkIn) : undefined}
            />
          </div>
        </div>

        {datesReady && (
          <p className="mt-3 text-sm text-muted-foreground">
            {nights} night{nights === 1 ? "" : "s"} ·{" "}
            {formatCheckoutDate(checkIn)} → {formatCheckoutDate(checkOut)}
            {availabilityFetching && (
              <Loader2 className="ml-2 inline h-3 w-3 animate-spin align-middle" />
            )}
          </p>
        )}
      </div>

      {grouped.map(({ property, rooms: propertyRooms }) => (
        <div key={property?.id ?? "unknown"} className="flex flex-col gap-3">
          {config.showPropertyHeaders && property && (
            <div>
              <h3 className="font-semibold">{property.name}</h3>
              {property.address && (
                <p className="text-xs text-muted-foreground">
                  {property.address}
                </p>
              )}
            </div>
          )}

          <div
            className={cn(
              "grid gap-4",
              config.layout === "grid"
                ? "sm:grid-cols-2 lg:grid-cols-3"
                : "grid-cols-1",
            )}
          >
            {propertyRooms.map((room) => (
              <RoomCard
                key={room.id}
                room={room}
                availability={availabilityById.get(room.id)}
                currency={currency}
                selected={selectedByRoom.get(room.id)}
                nights={nights}
                isPending={availabilityFetching}
                onSelect={() => handleSelect(room)}
                onRemove={() => removeAccommodation(room.id, checkIn, checkOut)}
              />
            ))}
          </div>
        </div>
      ))}

      {cart.accommodations.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold">Who is staying</h3>
          {cart.accommodations.map((item) => (
            <GuestBlock
              key={`${item.accommodationId}-${item.checkIn}`}
              item={item}
              room={roomById.get(item.accommodationId)}
              requireGuestNames={config.requireGuestNames}
            />
          ))}
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{config.noticeText}</span>
      </div>
    </div>
  )
}
