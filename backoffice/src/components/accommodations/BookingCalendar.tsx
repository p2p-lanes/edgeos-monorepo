import { useQuery } from "@tanstack/react-query"
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Lock,
} from "lucide-react"
import type * as React from "react"
import { useMemo, useState } from "react"

import {
  AccommodationsService,
  type CalendarAccommodation,
  type CalendarBooking,
} from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import useCustomToast from "@/hooks/useCustomToast"
import { cn } from "@/lib/utils"
import {
  type BookingDetail,
  BookingDetailDialog,
  detailFromCalendar,
} from "./BookingDetailDialog"
import { BlockDatesDialog, NewBookingDialog } from "./BookingDialog"
import {
  BOOKING_APPEARANCE,
  bookingAppearance,
  bookingBarLabel,
  CLOSED_DAY,
  CLOSED_DAY_HATCH,
  HOLD_HATCH,
} from "./bookingAppearance"
import {
  closedDays,
  DAY_WIDTH,
  dayNumber,
  eachDay,
  isWeekend,
  LABEL_WIDTH,
  layoutBookings,
  monthLabel,
  monthWindow,
  ROW_HEIGHT,
  shiftMonth,
  shortDay,
  todayKey,
  weekdayInitial,
} from "./calendarLayout"
import { downloadBookingsCsv } from "./exportBookings"

/**
 * Who is in which room, on which night.
 *
 * One horizontally-scrolling grid, no calendar library: rows are units
 * grouped under their room type and property, columns are days, and a stay is
 * an absolutely-positioned bar. The geometry lives in `calendarLayout` so the
 * part that is easy to get wrong is tested without a DOM.
 *
 * The per-day "Available" number sits on the room-type row rather than in a
 * separate footer row: it is read together with the room's name, and the
 * server already computes it so the two never disagree.
 *
 * Nights the room type cannot be sold on, because they fall outside its
 * bookable window or because the type is switched off, are greyed across the
 * whole block. An empty unit on such a night is not availability, and the
 * operator taking a phone booking is exactly the person who must not read it
 * as one.
 */

const ALL_PROPERTIES = "all"

function DayHeader({ days }: { days: string[] }) {
  const today = todayKey()
  return (
    <div className="sticky top-0 z-20 flex border-b-2 border-border bg-muted">
      <div
        className="sticky left-0 z-10 shrink-0 border-r border-border bg-muted px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        style={{ width: LABEL_WIDTH }}
      >
        Room
      </div>
      <div className="flex">
        {days.map((day) => (
          <div
            key={day}
            className={cn(
              "flex shrink-0 flex-col items-center justify-center border-r border-border py-1",
              isWeekend(day) && "bg-muted-foreground/10",
              day === today && "bg-primary/15",
            )}
            style={{ width: DAY_WIDTH }}
          >
            <span className="text-[10px] uppercase text-muted-foreground">
              {weekdayInitial(day)}
            </span>
            <span
              className={cn(
                "text-xs tabular-nums",
                day === today && "font-bold text-primary",
              )}
            >
              {dayNumber(day)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Day stripes behind the bars: weekends, today, and the nights this room
 * cannot be sold on, drawn once per row.
 *
 * The closed tint is applied last and wins over the weekend and today tints,
 * because "you cannot sell this night" outranks both.
 */
function DayStripes({ days, closed }: { days: string[]; closed: Set<string> }) {
  const today = todayKey()
  return (
    <>
      {days.map((day, index) => {
        const isClosed = closed.has(day)
        return (
          <div
            key={day}
            className={cn(
              "absolute top-0 bottom-0 border-r border-border/60",
              isWeekend(day) && "bg-muted-foreground/5",
              day === today && "bg-primary/10",
              isClosed && CLOSED_DAY.className,
            )}
            style={{
              left: index * DAY_WIDTH,
              width: DAY_WIDTH,
              ...(isClosed ? CLOSED_DAY_HATCH : {}),
            }}
          />
        )
      })}
    </>
  )
}

function AvailabilityRow({
  accommodation,
  days,
  closed,
}: {
  accommodation: CalendarAccommodation
  days: string[]
  closed: Set<string>
}) {
  const availability = accommodation.availability_by_day ?? {}
  const unitCount = accommodation.units?.length ?? 0
  // The window is a check-out bound, so it reads as "you can stay from A and
  // must be out by B", which is the sentence an operator would say out loud.
  const window = `on sale ${shortDay(accommodation.bookable_from)} to ${shortDay(accommodation.bookable_to)}`
  return (
    <div className="flex border-b border-border bg-card/60">
      <div
        className="sticky left-0 z-10 shrink-0 border-r border-border bg-card px-3 py-1.5"
        style={{ width: LABEL_WIDTH }}
      >
        <div className="truncate text-sm font-medium">{accommodation.name}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {unitCount} unit{unitCount === 1 ? "" : "s"} · sleeps{" "}
          {accommodation.guest_capacity}
          {accommodation.is_active === false && " · off"}
        </div>
      </div>
      <div className="relative flex" style={{ height: ROW_HEIGHT + 12 }}>
        {days.map((day) => {
          const isClosed = closed.has(day)
          const free = availability[day] ?? 0
          return (
            <div
              key={day}
              className={cn(
                "flex shrink-0 items-center justify-center border-r border-border/60 text-xs tabular-nums",
                isWeekend(day) && "bg-muted-foreground/5",
                isClosed
                  ? CLOSED_DAY.className
                  : free === 0
                    ? "font-semibold text-destructive"
                    : "text-muted-foreground",
              )}
              style={{
                width: DAY_WIDTH,
                ...(isClosed ? CLOSED_DAY_HATCH : {}),
              }}
              title={
                isClosed
                  ? accommodation.is_active === false
                    ? `${accommodation.name} is switched off and cannot be sold`
                    : `${day} is outside this room's booking window (${window})`
                  : `${free} free on ${day}`
              }
            >
              {isClosed ? "" : free}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function UnitRow({
  label,
  isActive,
  bookings,
  days,
  from,
  to,
  closed,
  onBookingClick,
  onEmptyClick,
}: {
  label: string
  isActive: boolean
  bookings: CalendarBooking[]
  days: string[]
  from: string
  to: string
  /** Nights the room type is not on sale for; see `closedDays`. */
  closed: Set<string>
  onBookingClick: (booking: CalendarBooking) => void
  onEmptyClick: (day: string) => void
}) {
  const bars = layoutBookings(bookings, from, to)
  // A retired unit is off the market whatever its room type's window says, so
  // its whole row greys out rather than only the nights outside that window.
  const closedHere = isActive ? closed : new Set(days)

  const handleSurfaceClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const index = Math.floor((event.clientX - rect.left) / DAY_WIDTH)
    const day = days[index]
    if (day) onEmptyClick(day)
  }

  return (
    <div className="flex border-b border-border">
      <div
        className="sticky left-0 z-10 shrink-0 border-r border-border bg-card py-1 pl-7 pr-3"
        style={{ width: LABEL_WIDTH }}
      >
        <span
          className={cn(
            "text-xs",
            isActive
              ? "text-muted-foreground"
              : "text-muted-foreground/60 line-through",
          )}
        >
          {label}
        </span>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: the row is a positioning context for the bars laid over it; a <button> cannot contain them */}
      <div
        className="relative cursor-copy"
        style={{ width: days.length * DAY_WIDTH, height: ROW_HEIGHT }}
        onClick={handleSurfaceClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" && days[0]) onEmptyClick(days[0])
        }}
        role="button"
        tabIndex={0}
        aria-label={`Book ${label}`}
      >
        <DayStripes days={days} closed={closedHere} />
        {bars.map((bar) => {
          const appearance = bookingAppearance(bar.booking)
          const isHold = bar.booking.status === "hold"
          return (
            // biome-ignore lint/a11y/useSemanticElements: absolute-positioned bar nested inside the clickable row; a <button> inside a button is invalid
            <div
              key={bar.booking.id}
              className={cn(
                "absolute top-1 flex cursor-pointer items-center overflow-hidden px-1.5 text-[11px] font-medium leading-none shadow-sm",
                bar.openStart ? "rounded-l-none" : "rounded-l-full",
                bar.openEnd ? "rounded-r-none" : "rounded-r-full",
                appearance.className,
              )}
              style={{
                left: bar.left,
                width: bar.width,
                height: ROW_HEIGHT - 8,
                ...(isHold ? HOLD_HATCH : {}),
              }}
              title={`${bookingBarLabel(bar.booking)} · ${bar.booking.check_in} → ${bar.booking.check_out}`}
              onClick={(event) => {
                event.stopPropagation()
                onBookingClick(bar.booking)
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.stopPropagation()
                  onBookingClick(bar.booking)
                }
              }}
              role="button"
              tabIndex={0}
            >
              <span className="truncate">{bookingBarLabel(bar.booking)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      {Object.entries(BOOKING_APPEARANCE)
        .filter(([key]) => key !== "released")
        .map(([key, appearance]) => (
          <span key={key} className="flex items-center gap-1.5">
            <span
              className={cn("size-3 rounded-sm", appearance.swatchClassName)}
              style={key === "hold" ? HOLD_HATCH : undefined}
            />
            {appearance.label}
          </span>
        ))}
      {/* Not a booking state: the absence of one, which is why it is spelled
          out here rather than folded into BOOKING_APPEARANCE. */}
      <span
        className="flex items-center gap-1.5"
        title={CLOSED_DAY.description}
      >
        <span
          className={cn("size-3 rounded-sm", CLOSED_DAY.swatchClassName)}
          style={CLOSED_DAY_HATCH}
        />
        {CLOSED_DAY.label}
      </span>
    </div>
  )
}

export function BookingCalendar({ popupId }: { popupId: string }) {
  const { showErrorToast } = useCustomToast()
  const [anchor, setAnchor] = useState(() => monthWindow(todayKey()).from)
  const [propertyId, setPropertyId] = useState(ALL_PROPERTIES)
  const [search, setSearch] = useState("")
  const [detail, setDetail] = useState<{
    booking: BookingDetail
    roomName: string
    units: { id: string; label: string }[]
  } | null>(null)
  const [newBooking, setNewBooking] = useState<{
    accommodationId?: string
    unitId?: string
    checkIn?: string
  } | null>(null)
  const [blocking, setBlocking] = useState(false)

  const { from, to } = useMemo(() => monthWindow(anchor), [anchor])
  const days = useMemo(() => eachDay(from, to), [from, to])

  const { data: properties } = useQuery({
    queryKey: ["accommodations", "properties", popupId],
    queryFn: () => AccommodationsService.listProperties({ popupId }),
    enabled: !!popupId,
  })

  const { data: calendar, isFetching } = useQuery({
    queryKey: ["accommodations", "calendar", popupId, from, to, propertyId],
    queryFn: () =>
      AccommodationsService.getCalendar({
        popupId,
        dateFrom: from,
        dateTo: to,
        propertyId: propertyId === ALL_PROPERTIES ? undefined : propertyId,
      }),
    enabled: !!popupId,
  })

  const query = search.trim().toLowerCase()
  const matchesSearch = (booking: CalendarBooking) =>
    !query ||
    (booking.primary_guest_name ?? "").toLowerCase().includes(query) ||
    (booking.primary_guest_email ?? "").toLowerCase().includes(query) ||
    (booking.notes ?? "").toLowerCase().includes(query)

  const exportCsv = async () => {
    try {
      await downloadBookingsCsv({
        popupId,
        dateFrom: from,
        dateTo: to,
        propertyId: propertyId === ALL_PROPERTIES ? null : propertyId,
      })
    } catch {
      showErrorToast("The export could not be generated")
    }
  }

  const isEmpty = calendar?.properties?.length === 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous month"
            onClick={() => setAnchor(shiftMonth(anchor, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next month"
            onClick={() => setAnchor(shiftMonth(anchor, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAnchor(monthWindow(todayKey()).from)}
          >
            Today
          </Button>
        </div>

        <span className="min-w-40 text-sm font-semibold">
          {monthLabel(from)}
          {isFetching && (
            <Loader2 className="ml-2 inline h-3 w-3 animate-spin align-middle" />
          )}
        </span>

        <Select value={propertyId} onValueChange={setPropertyId}>
          <SelectTrigger className="w-52" aria-label="Property">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROPERTIES}>All properties</SelectItem>
            {(properties?.results ?? []).map((property) => (
              <SelectItem key={property.id} value={property.id}>
                {property.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          className="w-52"
          placeholder="Find a guest"
          aria-label="Find a guest"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => setBlocking(true)}>
            <Lock className="mr-2 h-4 w-4" />
            Block dates
          </Button>
          <Button size="sm" onClick={() => setNewBooking({})}>
            <CalendarPlus className="mr-2 h-4 w-4" />
            New booking
          </Button>
        </div>
      </div>

      {!calendar ? (
        <Skeleton className="h-96 w-full" />
      ) : isEmpty ? (
        <div className="rounded-lg border-2 border-dashed p-8 text-center text-sm text-muted-foreground">
          No properties yet. The calendar fills in once there is a property with
          room types and units.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border-2 border-border bg-card">
          <div className="max-h-[640px] overflow-auto">
            <div style={{ width: LABEL_WIDTH + days.length * DAY_WIDTH }}>
              <DayHeader days={days} />

              {(calendar.properties ?? []).map((property) => (
                <div key={property.id}>
                  <div className="flex border-b border-border bg-muted/60">
                    <div
                      className="sticky left-0 z-10 shrink-0 bg-muted/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide"
                      style={{ width: LABEL_WIDTH }}
                    >
                      {property.name}
                    </div>
                    <div style={{ width: days.length * DAY_WIDTH }} />
                  </div>

                  {(property.accommodations ?? []).map((accommodation) => {
                    // One set per room type, shared by its availability row
                    // and every one of its unit rows.
                    const closed = closedDays(days, accommodation)
                    return (
                      <div key={accommodation.id}>
                        <AvailabilityRow
                          accommodation={accommodation}
                          days={days}
                          closed={closed}
                        />
                        {(accommodation.units ?? []).map((unit) => (
                          <UnitRow
                            key={unit.id}
                            label={unit.label}
                            isActive={unit.is_active}
                            days={days}
                            from={from}
                            to={to}
                            closed={closed}
                            bookings={(unit.bookings ?? []).filter(
                              matchesSearch,
                            )}
                            onBookingClick={(booking) =>
                              setDetail({
                                booking: detailFromCalendar(booking),
                                roomName: accommodation.name,
                                units: (accommodation.units ?? []).map(
                                  (item) => ({
                                    id: item.id,
                                    label: item.label,
                                  }),
                                ),
                              })
                            }
                            onEmptyClick={(day) =>
                              setNewBooking({
                                accommodationId: accommodation.id,
                                unitId: unit.id,
                                checkIn: day,
                              })
                            }
                          />
                        ))}
                        {(accommodation.units ?? []).length === 0 && (
                          <div className="flex border-b border-border">
                            <div
                              className="sticky left-0 z-10 shrink-0 border-r border-border bg-card py-1 pl-7 pr-3 text-xs text-muted-foreground"
                              style={{ width: LABEL_WIDTH }}
                            >
                              No units · cannot be booked
                            </div>
                            <div style={{ width: days.length * DAY_WIDTH }} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <Legend />

      <BookingDetailDialog
        booking={detail?.booking ?? null}
        roomName={detail?.roomName ?? ""}
        units={detail?.units ?? []}
        open={!!detail}
        onOpenChange={(open) => !open && setDetail(null)}
      />

      {newBooking && (
        <NewBookingDialog
          popupId={popupId}
          open
          onOpenChange={(open) => !open && setNewBooking(null)}
          prefill={newBooking}
        />
      )}

      {blocking && (
        <BlockDatesDialog
          popupId={popupId}
          open
          onOpenChange={(open) => !open && setBlocking(open)}
        />
      )}
    </div>
  )
}
