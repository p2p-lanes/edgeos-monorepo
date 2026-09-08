"use client"

/**
 * The accommodation checkout step.
 *
 * Reads nothing from `products`: rooms are not products the buyer browses,
 * they are inventory that only means anything once dates exist. So the step
 * asks for a stay first, then asks the server what is free and what it costs,
 * and only then shows rooms. Every price on this screen is a server quote:
 * nightly rate times nights is wrong as soon as a date-range rule or the
 * long-stay rate applies, so the client never multiplies.
 *
 * A room the buyer cannot book is not shown. It used to be greyed out with
 * the reason printed inside the button that would have booked it, which put
 * a label where the affordance was and left it at disabled contrast. What
 * replaces it is `accommodationBoard`: the board holds only bookable rooms,
 * and everything removed is accounted for underneath, with a button where
 * the offer itself says how to get it back.
 *
 * `template_config` governs presentation only (`layout`,
 * `show_property_headers`, `require_guest_names`, `notice_text`) and the
 * questions asked about the people staying. Which properties are on offer is
 * enforced by the backend, which filters both endpoints by the step's subset.
 * The client could not be trusted with that and is not asked to be.
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Info, Loader2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  type AccommodationOffer,
  AccommodationsService,
  CheckoutService,
  type PublicAccommodation,
  type PublicAccommodationAvailability,
} from "@/client"
import { Button } from "@/components/ui/button"
import {
  addDays,
  bookableBounds,
  buildBoard,
  largestParty,
  recoveriesFor,
} from "@/lib/accommodationBoard"
import {
  type AccommodationGuestForm,
  parseGuestForm,
} from "@/lib/accommodationForm"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import {
  calculateNights,
  formatCheckoutDate,
  type SelectedAccommodationItem,
} from "@/types/checkout"
import type { VariantProps } from "../registries/variantRegistry"
import { GuestDetailsPanel } from "./accommodation/GuestDetailsPanel"
import { RecoveryNotes } from "./accommodation/RecoveryNotes"
import { RoomCard, RoomRow, RoomSheetRow } from "./accommodation/RoomViews"
import { StayBar } from "./accommodation/StayBar"

type Layout = "rows" | "cards" | "sheet"

/** What the first two layouts were called before there was a third. */
const RENAMED_LAYOUTS: Record<string, Layout> = { grid: "cards", list: "rows" }

interface AccommodationTemplateConfig {
  layout: Layout
  showPropertyHeaders: boolean
  requireGuestNames: boolean
  guestForm: AccommodationGuestForm | null
  noticeText: string
}

function parseLayout(raw: unknown): Layout {
  if (typeof raw !== "string") return "rows"
  const renamed = RENAMED_LAYOUTS[raw]
  if (renamed) return renamed
  return raw === "cards" || raw === "sheet" || raw === "rows" ? raw : "rows"
}

function parseConfig(
  raw: VariantProps["templateConfig"],
  defaultNotice: string,
): AccommodationTemplateConfig {
  const config = (raw ?? {}) as Record<string, unknown>
  return {
    layout: parseLayout(config.layout),
    showPropertyHeaders: config.show_property_headers !== false,
    requireGuestNames: config.require_guest_names !== false,
    // The questions come from the step, not from the room: one form for the
    // whole checkout, so a buyer booking two rooms is asked one thing.
    guestForm: parseGuestForm(config.guest_form),
    noticeText:
      typeof config.notice_text === "string" && config.notice_text.trim()
        ? config.notice_text
        : defaultNotice,
  }
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
    setAccommodationGuestCount,
    clearAccommodationsOutsideStay,
    previewToken,
    salesFlowId,
    salesFlowSlug,
    submitMode,
  } = useCheckout()

  const config = useMemo(
    () =>
      parseConfig(templateConfig, t("checkout.accommodation.default_notice")),
    [templateConfig, t],
  )
  const city = getCity()
  const slug = city?.slug ?? ""
  const popupId = city?.id ?? ""
  const currency = city?.currency ?? undefined

  // Two doors to the same inventory. The anonymous endpoints only serve
  // `sale_type=direct` popups; an application popup's rooms live behind the
  // logged-in portal ones, exactly as its products do.
  const isOpenCheckout = submitMode === "open-ticketing"
  const canFetch = isOpenCheckout
    ? !!slug && !!salesFlowSlug
    : !!popupId && !!salesFlowId

  const { data: offer, isLoading: offerLoading } = useQuery<AccommodationOffer>(
    {
      queryKey: [
        "checkout-accommodations",
        submitMode,
        slug,
        popupId,
        salesFlowSlug,
        salesFlowId,
        previewToken,
      ],
      queryFn: () =>
        isOpenCheckout
          ? CheckoutService.listCheckoutAccommodations({
              slug,
              flowSlug: salesFlowSlug!,
              xCheckoutPreviewToken: previewToken ?? undefined,
            })
          : AccommodationsService.listPortalAccommodations({
              popupId,
              salesFlowId: salesFlowId!,
            }),
      enabled: canFetch,
      staleTime: 60_000,
      // A popup with the step turned off answers 404; retrying will not change
      // its mind, and the step renders its empty state instead.
      retry: false,
    },
  )

  const rooms = useMemo(() => offer?.accommodations ?? [], [offer])
  const bounds = useMemo(() => bookableBounds(rooms), [rooms])
  const maxGuests = useMemo(() => largestParty(rooms), [rooms])

  const [checkIn, setCheckIn] = useState("")
  const [checkOut, setCheckOut] = useState("")
  const [guests, setGuests] = useState(1)
  const [openRoomId, setOpenRoomId] = useState<string | null>(null)
  const [dropped, setDropped] = useState<{
    name: string
    reason: string
  } | null>(null)

  const accommodationScope = isOpenCheckout
    ? `open:${slug}:${salesFlowSlug ?? ""}`
    : `portal:${popupId}:${salesFlowId ?? ""}`
  const previousAccommodationScopeRef = useRef(accommodationScope)

  useEffect(() => {
    if (previousAccommodationScopeRef.current === accommodationScope) return
    previousAccommodationScopeRef.current = accommodationScope
    setCheckIn("")
    setCheckOut("")
    setGuests(1)
  }, [accommodationScope])

  /**
   * The shortest stay that any room here accepts.
   *
   * Seeding one night would open the step on an empty board wherever a
   * minimum is configured, and the buyer would have to guess that the fix is
   * to push check-out out, before ever seeing a price.
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
      salesFlowSlug,
      salesFlowId,
      previewToken,
      checkIn,
      checkOut,
      guests,
    ],
    queryFn: () =>
      isOpenCheckout
        ? CheckoutService.checkAccommodationAvailability({
            slug,
            flowSlug: salesFlowSlug!,
            xCheckoutPreviewToken: previewToken ?? undefined,
            requestBody: {
              check_in: checkIn,
              check_out: checkOut,
              guest_count: guests,
            },
          })
        : AccommodationsService.checkPortalAccommodationAvailability({
            popupId,
            salesFlowId: salesFlowId!,
            requestBody: {
              check_in: checkIn,
              check_out: checkOut,
              guest_count: guests,
            },
          }),
    enabled: canFetch && datesReady,
    staleTime: 30_000,
    retry: false,
    // Keep the previous board while the next one is being priced. Rooms
    // vanishing and reappearing on every date change reads as a broken page,
    // and it is the one thing hiding them makes worse than greying them out.
    placeholderData: keepPreviousData,
  })

  const availabilityById = useMemo(
    () =>
      new Map((availability ?? []).map((row) => [row.accommodation_id, row])),
    [availability],
  )

  const board = useMemo(
    () => buildBoard(rooms, availabilityById),
    [rooms, availabilityById],
  )
  const stay = useMemo(
    () => ({ checkIn, checkOut, nights, guests }),
    [checkIn, checkOut, nights, guests],
  )
  const recoveries = useMemo(
    () => recoveriesFor(board.blocked, stay),
    [board.blocked, stay],
  )

  const propertyById = useMemo(
    () => new Map((offer?.properties ?? []).map((row) => [row.id, row])),
    [offer],
  )

  const selected = cart.accommodations[0]

  /**
   * Drop a room the stay has just made unbookable.
   *
   * Raising the party size past a room's capacity, or moving onto a night it
   * is taken, leaves the cart holding a stay the purchase would refuse. The
   * buyer is told which room went and why, because a room disappearing from
   * the summary on its own is indistinguishable from a bug.
   */
  useEffect(() => {
    if (!selected) return
    const blocked = board.blocked.find(
      (entry) => entry.room.id === selected.accommodationId,
    )
    if (!blocked?.reason) return
    setDropped({ name: blocked.room.name, reason: blocked.reason })
    removeAccommodation(
      selected.accommodationId,
      selected.checkIn,
      selected.checkOut,
    )
  }, [board.blocked, selected, removeAccommodation])

  // The party size lives on the stay now, so the booked room follows it
  // rather than carrying a count of its own.
  useEffect(() => {
    if (!selected || selected.guestCount === guests) return
    setAccommodationGuestCount(
      selected.accommodationId,
      selected.checkIn,
      selected.checkOut,
      guests,
    )
  }, [guests, selected, setAccommodationGuestCount])

  // Moving the stay invalidates every quote in the cart, so the room booked
  // for the old nights goes with it rather than being silently re-priced.
  const applyStay = (nextIn: string, nextOut: string) => {
    setDropped(null)
    setCheckIn(nextIn)
    setCheckOut(nextOut)
    clearAccommodationsOutsideStay(nextIn, nextOut)
  }

  /** Lengthen the stay to the minimum a removed room asks for. */
  const extendStay = (toNights: number) => {
    const nextOut = addDays(checkIn, toNights)
    applyStay(checkIn, bounds.to && nextOut > bounds.to ? bounds.to : nextOut)
  }

  /** Move the same-length stay onto the day a removed room opens. */
  const moveStay = (nextIn: string) => {
    const nextOut = addDays(nextIn, Math.max(1, nights))
    applyStay(nextIn, bounds.to && nextOut > bounds.to ? bounds.to : nextOut)
  }

  const grouped = useMemo(() => {
    const byProperty = new Map<string, typeof board.bookable>()
    for (const entry of board.bookable) {
      const list = byProperty.get(entry.room.property_id) ?? []
      list.push(entry)
      byProperty.set(entry.room.property_id, list)
    }
    return [...byProperty.entries()].map(([propertyId, entries]) => ({
      property: propertyById.get(propertyId),
      entries,
    }))
  }, [board.bookable, propertyById])

  const handleSelect = (room: PublicAccommodation) => {
    const row = availabilityById.get(room.id)
    if (!row?.quote || !room.product_id) return
    const property = propertyById.get(room.property_id)
    setDropped(null)
    const item: SelectedAccommodationItem = {
      accommodationId: room.id,
      productId: room.product_id,
      name: room.name,
      propertyId: room.property_id,
      propertyName: property?.name ?? "",
      checkIn,
      checkOut,
      nights,
      guestCount: guests,
      guests: Array.from({ length: guests }, () => ({
        name: "",
        answers: {},
      })),
      bookerAnswers: {},
      // Captured now rather than looked up later: the cart then carries what
      // it needs to be validated from screens where this step is not mounted.
      guestForm: config.guestForm,
      subtotal: Number(row.quote.subtotal),
      tax: Number(row.quote.tax),
      totalPrice: Number(row.quote.total),
      imageUrl: room.images?.[0]?.url ?? null,
    }
    addAccommodation(item)
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
        <p className="mb-6 text-gray-500">
          {t("checkout.accommodation.no_rooms")}
        </p>
        <Button variant="outline" onClick={onSkip}>
          {t("common.continue")}
        </Button>
      </div>
    )
  }

  const firstOpenId = board.bookable[0]?.room.id ?? null
  const settling = availabilityFetching || board.unanswered.length > 0

  const renderEntries = (entries: typeof board.bookable) => {
    if (config.layout === "sheet") {
      return (
        <div className="overflow-hidden rounded-2xl border bg-card">
          {entries.map((entry) => (
            <RoomSheetRow
              key={entry.room.id}
              entry={entry}
              currency={currency}
              nights={nights}
              selected={selected?.accommodationId === entry.room.id}
              open={(openRoomId ?? firstOpenId) === entry.room.id}
              onToggle={() =>
                setOpenRoomId(
                  (openRoomId ?? firstOpenId) === entry.room.id
                    ? ""
                    : entry.room.id,
                )
              }
              onSelect={() => handleSelect(entry.room)}
              onRemove={() =>
                removeAccommodation(entry.room.id, checkIn, checkOut)
              }
            />
          ))}
        </div>
      )
    }

    const View = config.layout === "cards" ? RoomCard : RoomRow
    return (
      <div
        className={cn(
          "grid gap-4",
          config.layout === "cards" ? "sm:grid-cols-2" : "grid-cols-1",
        )}
      >
        {entries.map((entry) => (
          <View
            key={entry.room.id}
            entry={entry}
            currency={currency}
            nights={nights}
            selected={selected?.accommodationId === entry.room.id}
            onSelect={() => handleSelect(entry.room)}
            onRemove={() =>
              removeAccommodation(entry.room.id, checkIn, checkOut)
            }
          />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <StayBar
        checkIn={checkIn}
        checkOut={checkOut}
        guests={guests}
        maxGuests={maxGuests}
        bounds={bounds}
        roomCount={board.bookable.length}
        loading={settling}
        onStayChange={applyStay}
        onGuestsChange={(next) => {
          setDropped(null)
          setGuests(next)
        }}
      />

      {dropped && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {t("checkout.accommodation.dropped", {
            room: dropped.name,
            reason: t(`checkout.accommodation.unavailable.${dropped.reason}`, {
              defaultValue: t("checkout.accommodation.unavailable.default"),
            }),
          })}
        </p>
      )}

      {board.bookable.length === 0 && !settling ? (
        <div className="flex flex-col gap-2 rounded-2xl border bg-card p-6">
          <p className="font-medium">
            {t("checkout.accommodation.empty.title", {
              from: formatCheckoutDate(checkIn),
              to: formatCheckoutDate(checkOut),
            })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("checkout.accommodation.empty.body")}
          </p>
        </div>
      ) : (
        grouped.map(({ property, entries }) => (
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
            {renderEntries(entries)}
          </div>
        ))
      )}

      <RecoveryNotes
        recoveries={recoveries}
        guests={guests}
        onExtendStay={extendStay}
        onMoveStay={moveStay}
      />

      {selected && (
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold">
            {t("checkout.accommodation.who_is_staying")}
          </h3>
          <GuestDetailsPanel
            key={`${selected.accommodationId}-${selected.checkIn}`}
            item={selected}
            requireGuestNames={config.requireGuestNames}
          />
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{config.noticeText}</span>
      </div>
    </div>
  )
}
