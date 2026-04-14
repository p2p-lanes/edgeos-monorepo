"use client"

import { useQueries, useQuery } from "@tanstack/react-query"
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
import { Calendar, ChevronLeft, ChevronRight, Clock, MapPin } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import {
  EventSettingsService,
  EventsService,
  EventVenuesService,
  type EventPublic,
  type EventVenuePublic,
} from "@/client"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useCityProvider } from "@/providers/cityProvider"
import { EventsToolbar } from "../lib/EventsToolbar"
import { useEventTimezone } from "../lib/useEventTimezone"

export default function CalendarPage() {
  const { getCity } = useCityProvider()
  const city = getCity()
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date())
  const [rsvpedOnly, setRsvpedOnly] = useState(false)
  const { timezone, formatTime, formatDayKey, formatGridDayKey } =
    useEventTimezone(city?.id)

  const { data: eventSettings } = useQuery({
    queryKey: ["portal-event-settings", city?.id],
    queryFn: () =>
      EventSettingsService.getPortalEventSettings({ popupId: city!.id }),
    enabled: !!city?.id,
  })

  const { data } = useQuery({
    queryKey: [
      "portal-events-calendar",
      city?.id,
      format(currentMonth, "yyyy-MM"),
      rsvpedOnly,
    ],
    queryFn: () =>
      EventsService.listPortalEvents({
        popupId: city!.id,
        eventStatus: "published",
        startAfter: startOfMonth(currentMonth).toISOString(),
        startBefore: endOfMonth(currentMonth).toISOString(),
        rsvpedOnly: rsvpedOnly || undefined,
        limit: 200,
      }),
    enabled: !!city?.id,
  })

  const events = data?.results ?? []

  function getEventsForDate(date: Date): EventPublic[] {
    const cellKey = formatGridDayKey(date)
    return events.filter((e) => formatDayKey(e.start_time) === cellKey)
  }

  // Batch-fetch venues for displayed events to show venue titles.
  const venueIds = Array.from(
    new Set(
      events
        .map((e) => e.venue_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  )
  const venueQueries = useQueries({
    queries: venueIds.map((venueId) => ({
      queryKey: ["portal-event-venue", venueId],
      queryFn: () => EventVenuesService.getVenue({ venueId }),
      staleTime: 5 * 60 * 1000,
    })),
  })
  const venueMap = new Map<string, EventVenuePublic>()
  venueQueries.forEach((q, idx) => {
    if (q.data) venueMap.set(venueIds[idx], q.data)
  })

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const days: Date[] = []
  let day = calStart
  while (day <= calEnd) {
    days.push(day)
    day = addDays(day, 1)
  }

  const selectedEvents = selectedDate ? getEventsForDate(selectedDate) : []
  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h1 className="text-xl font-bold">Calendar</h1>
          {timezone && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Times in {timezone}
            </p>
          )}
        </div>
        <EventsToolbar
          slug={city?.slug}
          view="calendar"
          rsvpedOnly={rsvpedOnly}
          onRsvpedOnlyChange={setRsvpedOnly}
          canCreate={eventSettings?.can_publish_event === "everyone"}
        />
      </div>

      <div className="grid lg:grid-cols-7 gap-5">
        {/* Calendar grid */}
        <div className="lg:col-span-3 rounded-xl border bg-card p-3">
          <div className="flex items-center justify-between mb-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
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
              const isSelected =
                selectedDate &&
                formatGridDayKey(d) === formatGridDayKey(selectedDate)
              return (
                <button
                  key={i}
                  onClick={() => setSelectedDate(d)}
                  className={cn(
                    "relative aspect-square flex flex-col items-center justify-center rounded-lg text-xs transition-colors",
                    !isCurrentMonth && "text-muted-foreground/30",
                    isCurrentMonth && "hover:bg-muted",
                    isToday(d) && "font-bold text-primary",
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

        {/* Selected day events */}
        <div className="lg:col-span-4">
          {selectedDate ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">
                  {format(selectedDate, "EEEE, MMMM d")}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {selectedEvents.length} event
                  {selectedEvents.length !== 1 ? "s" : ""}
                </span>
              </div>
              {selectedEvents.length === 0 ? (
                <div className="text-center py-8">
                  <Calendar className="mx-auto h-6 w-6 text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">
                    No events on this day
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedEvents.map((event) => {
                    const venue = event.venue_id
                      ? venueMap.get(event.venue_id)
                      : undefined
                    return (
                      <Link
                        key={event.id}
                        href={`/portal/${city?.slug}/events/${event.id}`}
                        className="block rounded-xl border bg-card p-3 hover:shadow-md transition-shadow"
                      >
                        <h4 className="text-sm font-medium">{event.title}</h4>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                          <Clock className="h-3 w-3" />
                          {formatTime(event.start_time)} –{" "}
                          {formatTime(event.end_time)}
                        </div>
                        {venue && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                            <MapPin className="h-3 w-3" />
                            <span className="truncate">
                              {venue.title}
                              {venue.location ? ` · ${venue.location}` : ""}
                            </span>
                          </div>
                        )}
                      </Link>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              Select a day to see events
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
