import { useQuery } from "@tanstack/react-query"
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns"
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
  MapPin,
  Repeat,
  Tag,
  Users,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { type EventPublic, type EventStatus, EventsService } from "@/client"
import { Button } from "@/components/ui/button"
import { summarizeRrule } from "@/lib/events/summarizeRrule"
import { useEventTimezone } from "@/lib/events/useEventTimezone"
import { cn } from "@/lib/utils"
import { CoverImage } from "./CoverImage"

interface EventsCalendarViewProps {
  popupId: string
  status: EventStatus | undefined
  venueId: string | undefined
  search: string
  defaultDate?: Date | null
  popupStart?: string | null
  popupEnd?: string | null
  onEventClick: (event: EventPublic) => void
}

function parsePopupDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const ymd = value.slice(0, 10)
  const [y, m, d] = ymd.split("-").map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, 12, 0, 0)
}

function localYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

/**
 * Month calendar + selected-day panel for the backoffice events page.
 * Mirrors the portal calendar but without RSVP / owner Crown — clicks
 * route the admin into the event edit page via `onEventClick`.
 */
export function EventsCalendarView({
  popupId,
  status,
  venueId,
  search,
  defaultDate,
  popupStart,
  popupEnd,
  onEventClick,
}: EventsCalendarViewProps) {
  const minDate = parsePopupDate(popupStart)
  const maxDate = parsePopupDate(popupEnd)
  const minYmd = popupStart?.slice(0, 10) ?? null
  const maxYmd = popupEnd?.slice(0, 10) ?? null

  const initialDate = (() => {
    if (defaultDate) return defaultDate
    const today = new Date()
    const todayYmd = localYmd(today)
    if (minYmd && todayYmd < minYmd && minDate) return minDate
    if (maxYmd && todayYmd > maxYmd && maxDate) return maxDate
    return today
  })()
  const [currentMonth, setCurrentMonth] = useState(initialDate)
  const [selectedDate, setSelectedDate] = useState<Date | null>(initialDate)

  const didSnapToDefaultRef = useRef(defaultDate != null)
  useEffect(() => {
    if (didSnapToDefaultRef.current || !defaultDate) return
    didSnapToDefaultRef.current = true
    setCurrentMonth(defaultDate)
    setSelectedDate(defaultDate)
  }, [defaultDate])

  // Once the popup boundary loads, snap into range if today (initial
  // selection) was outside the popup window.
  const didSnapToRangeRef = useRef(false)
  useEffect(() => {
    if (didSnapToRangeRef.current) return
    if (!minYmd && !maxYmd) return
    didSnapToRangeRef.current = true
    const currentYmd = localYmd(currentMonth)
    if (minYmd && currentYmd < minYmd && minDate) {
      setCurrentMonth(minDate)
      setSelectedDate(minDate)
    } else if (maxYmd && currentYmd > maxYmd && maxDate) {
      setCurrentMonth(maxDate)
      setSelectedDate(maxDate)
    }
  }, [minDate, maxDate, minYmd, maxYmd, currentMonth])

  const isAtFirstMonth =
    !!minDate &&
    currentMonth.getFullYear() === minDate.getFullYear() &&
    currentMonth.getMonth() === minDate.getMonth()
  const isAtLastMonth =
    !!maxDate &&
    currentMonth.getFullYear() === maxDate.getFullYear() &&
    currentMonth.getMonth() === maxDate.getMonth()

  const { formatTime, formatDayKey } = useEventTimezone(popupId)

  const { data } = useQuery({
    queryKey: [
      "events",
      "calendar",
      popupId,
      format(currentMonth, "yyyy-MM"),
      status,
      venueId,
      search,
    ],
    queryFn: () =>
      EventsService.listEvents({
        popupId,
        eventStatus: status,
        venueId:
          venueId && venueId !== "custom" && venueId !== "meeting"
            ? venueId
            : undefined,
        locationKind:
          venueId === "custom" || venueId === "meeting" ? venueId : undefined,
        search: search || undefined,
        startAfter: startOfMonth(currentMonth).toISOString(),
        startBefore: endOfMonth(currentMonth).toISOString(),
        limit: 200,
      }),
    enabled: !!popupId,
  })

  const events = data?.results ?? []

  // Grid cells are calendar days (number labels) — match them against
  // events by formatting both sides in the popup's timezone, so an event
  // saved as "June 4 1pm popup-tz" lands in the "June 4" cell regardless
  // of where the browser is.
  function getEventsForDate(date: Date): EventPublic[] {
    const cellKey = localYmd(date)
    return events.filter((e) => formatDayKey(e.start_time) === cellKey)
  }

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const days: Date[] = []
  let day = gridStart
  while (day <= gridEnd) {
    days.push(day)
    day = addDays(day, 1)
  }

  const selectedEvents = selectedDate ? getEventsForDate(selectedDate) : []
  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

  return (
    <div className="grid lg:grid-cols-7 gap-5 items-start">
      <div className="min-w-0 lg:col-span-3 rounded-xl border bg-card p-3 lg:sticky lg:top-4 lg:self-start">
        <div className="flex items-center justify-between mb-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={isAtFirstMonth}
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-sm font-semibold capitalize">
            {format(currentMonth, "MMMM yyyy")}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={isAtLastMonth}
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-7 mb-1">
          {dayLabels.map((d) => (
            <div
              key={d}
              className="text-center text-[10px] font-medium text-muted-foreground py-1"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-px">
          {days.map((d, i) => {
            const dayEvents = getEventsForDate(d)
            const isCurrentMonth = isSameMonth(d, currentMonth)
            const cellYmd = localYmd(d)
            const isOutOfRange =
              (!!minYmd && cellYmd < minYmd) || (!!maxYmd && cellYmd > maxYmd)
            const isSelected =
              selectedDate && localYmd(d) === localYmd(selectedDate)
            return (
              <button
                key={i}
                type="button"
                disabled={isOutOfRange}
                onClick={() => setSelectedDate(d)}
                className={cn(
                  "relative aspect-square flex flex-col items-center justify-center rounded-lg text-xs transition-colors",
                  !isCurrentMonth && "text-muted-foreground/30",
                  isCurrentMonth && !isOutOfRange && "hover:bg-muted",
                  isOutOfRange && "text-muted-foreground/30 cursor-not-allowed",
                  isToday(d) && !isOutOfRange && "font-bold text-primary",
                  isSelected && "bg-primary/10 ring-2 ring-primary",
                )}
              >
                <span>{format(d, "d")}</span>
                {dayEvents.length > 0 && (
                  <div className="flex gap-px mt-px">
                    {dayEvents.slice(0, 3).map((_, idx) => (
                      <div
                        key={idx}
                        className="h-1 w-1 rounded-full bg-primary"
                      />
                    ))}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="min-w-0 lg:col-span-4">
        {selectedDate ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">
                {format(selectedDate, "EEEE, MMMM d")}
              </h3>
              <span className="text-xs text-muted-foreground">
                {selectedEvents.length}{" "}
                {selectedEvents.length === 1 ? "event" : "events"}
              </span>
            </div>
            {selectedEvents.length === 0 ? (
              <div className="text-center py-8">
                <CalendarIcon className="mx-auto h-6 w-6 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">
                  No events on this day
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {selectedEvents.map((event) => {
                  const recurrenceLabel =
                    summarizeRrule(event.rrule) ??
                    (event.recurrence_master_id
                      ? "Part of a recurring series"
                      : null)
                  const isHighlighted = event.highlighted === true
                  return (
                    <div
                      key={event.id}
                      className={cn(
                        "relative rounded-xl border bg-card hover:shadow-md transition-shadow overflow-hidden",
                        isHighlighted &&
                          "border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onEventClick(event)}
                        className="block w-full text-left p-3"
                      >
                        <div className="flex items-start gap-3">
                          {event.venue_image_url && (
                            <div className="h-12 w-12 rounded-md overflow-hidden shrink-0">
                              <CoverImage
                                src={event.venue_image_url}
                                alt={event.venue_title ?? ""}
                                className="h-full w-full object-cover"
                                fallback={
                                  <MapPin className="h-5 w-5 text-muted-foreground/40" />
                                }
                              />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <h4 className="text-sm font-medium truncate">
                              {event.title}
                            </h4>
                            {event.kind && (
                              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mt-0.5 truncate">
                                {event.kind}
                              </p>
                            )}
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                              <Clock className="h-3 w-3" />
                              {formatTime(event.start_time)} –{" "}
                              {formatTime(event.end_time)}
                            </div>
                            {event.venue_title && (
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                                <MapPin className="h-3 w-3" />
                                <span className="truncate">
                                  {event.venue_title}
                                  {event.venue_location
                                    ? ` · ${event.venue_location}`
                                    : ""}
                                </span>
                              </div>
                            )}
                            {recurrenceLabel && (
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                                <Repeat className="h-3 w-3" />
                                <span className="truncate">
                                  {recurrenceLabel}
                                </span>
                              </div>
                            )}
                            {event.max_participant != null && (
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                                <Users className="h-3 w-3" />
                                <span>{event.max_participant} max</span>
                              </div>
                            )}
                            {event.track_title && (
                              <div className="flex items-center gap-1.5 text-xs font-medium text-violet-700 dark:text-violet-300 mt-0.5">
                                <Layers className="h-3 w-3" />
                                <span className="truncate">
                                  {event.track_title}
                                </span>
                              </div>
                            )}
                            {event.tags && event.tags.length > 0 && (
                              <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                                {event.tags.slice(0, 3).map((tag: string) => (
                                  <span
                                    key={tag}
                                    className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/60 text-muted-foreground"
                                  >
                                    <Tag className="h-2.5 w-2.5" />
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">
            Select a day
          </p>
        )}
      </div>
    </div>
  )
}
