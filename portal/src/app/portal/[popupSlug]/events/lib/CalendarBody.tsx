"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Repeat,
  Tag,
  Users,
} from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import {
  EventParticipantsService,
  type EventPublic,
  EventsService,
} from "@/client"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { summarizeRrule } from "./summarizeRrule"
import { useEventTimezone } from "./useEventTimezone"

interface CalendarBodyProps {
  popupId: string | undefined
  slug: string | undefined
  search: string
  rsvpedOnly: boolean
  tags?: string[]
}

/**
 * Month calendar + selected-day panel, designed to be rendered inside the
 * same /events page as the list view. Shares the search/rsvpedOnly filters
 * coming from the toolbar.
 */
export function CalendarBody({
  popupId,
  slug,
  search,
  rsvpedOnly,
  tags,
}: CalendarBodyProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date())
  const { formatTime, formatDayKey, formatGridDayKey } =
    useEventTimezone(popupId)

  const { data } = useQuery({
    queryKey: [
      "portal-events-calendar",
      popupId,
      format(currentMonth, "yyyy-MM"),
      rsvpedOnly,
      search,
      tags,
    ],
    queryFn: () =>
      EventsService.listPortalEvents({
        popupId: popupId!,
        eventStatus: "published",
        startAfter: startOfMonth(currentMonth).toISOString(),
        startBefore: endOfMonth(currentMonth).toISOString(),
        rsvpedOnly: rsvpedOnly || undefined,
        search: search || undefined,
        tags: tags?.length ? tags : undefined,
        limit: 200,
      }),
    enabled: !!popupId,
  })

  // For recurring instances we must include occurrence_start; one-off events
  // must not. Use occurrence_id (set only on virtual occurrences) to decide.
  const rsvpBodyFor = (e: EventPublic) =>
    e.occurrence_id ? { occurrence_start: e.start_time } : undefined
  const rsvpMutation = useMutation({
    mutationFn: (e: EventPublic) =>
      EventParticipantsService.registerForEvent({
        eventId: e.id,
        requestBody: rsvpBodyFor(e),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-events-calendar"] })
    },
  })
  const cancelRsvpMutation = useMutation({
    mutationFn: (e: EventPublic) =>
      EventParticipantsService.cancelRegistration({
        eventId: e.id,
        requestBody: rsvpBodyFor(e),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-events-calendar"] })
    },
  })

  const events = data?.results ?? []

  function getEventsForDate(date: Date): EventPublic[] {
    const cellKey = formatGridDayKey(date)
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
    // `min-w-0` on each grid child prevents intrinsic content width from
    // forcing the column wider than its track — otherwise a long event
    // title/kind/venue string in the selected-day panel pushes the whole
    // grid (including the calendar) past the viewport on mobile.
    <div className="grid lg:grid-cols-7 gap-5">
      <div className="min-w-0 lg:col-span-3 rounded-xl border bg-card p-3">
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
                type="button"
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

      <div className="min-w-0 lg:col-span-4">
        {selectedDate ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">
                {format(selectedDate, "EEEE, MMMM d")}
              </h3>
              <span className="text-xs text-muted-foreground">
                {t("events.calendar.selected_events", {
                  count: selectedEvents.length,
                })}
              </span>
            </div>
            {selectedEvents.length === 0 ? (
              <div className="text-center py-8">
                <CalendarIcon className="mx-auto h-6 w-6 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">
                  {t("events.calendar.no_events_on_day")}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {selectedEvents.map((event) => {
                  const recurrenceLabel =
                    summarizeRrule(event.rrule) ??
                    (event.recurrence_master_id
                      ? t("events.list.part_of_recurring_series")
                      : null)
                  return (
                    <div
                      key={event.id}
                      className="relative rounded-xl border bg-card hover:shadow-md transition-shadow overflow-hidden"
                    >
                      <Link
                        href={
                          event.occurrence_id
                            ? `/portal/${slug}/events/${event.id}?occ=${encodeURIComponent(event.start_time)}`
                            : `/portal/${slug}/events/${event.id}`
                        }
                        className="block p-3"
                      >
                        <div className="flex items-start gap-3">
                          {event.venue_image_url && (
                            <div className="h-12 w-12 rounded-md overflow-hidden shrink-0 bg-muted">
                              {/* biome-ignore lint/performance/noImgElement: external S3 URL, next/image not configured */}
                              <img
                                src={event.venue_image_url}
                                alt={event.venue_title ?? ""}
                                className="h-full w-full object-cover"
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
                                <span>
                                  {t("events.calendar.max_participants", {
                                    count: event.max_participant,
                                  })}
                                </span>
                              </div>
                            )}
                            {event.tags && event.tags.length > 0 && (
                              <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                                {event.tags.slice(0, 3).map((tag: string) => (
                                  <span
                                    key={tag}
                                    className="inline-flex items-center gap-0.5 text-[10px] bg-muted px-1.5 py-0.5 rounded"
                                  >
                                    <Tag className="h-2.5 w-2.5" />
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </Link>
                      {event.status === "published" && (
                        <div className="absolute top-2 right-2">
                          {event.my_rsvp_status &&
                          event.my_rsvp_status !== "cancelled" ? (
                            <button
                              type="button"
                              onClick={() =>
                                cancelRsvpMutation.mutate(event)
                              }
                              className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20"
                            >
                              <CheckCircle className="h-3 w-3" />
                              {t("events.rsvp.going")}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => rsvpMutation.mutate(event)}
                              className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-muted"
                            >
                              {t("events.rsvp.rsvp")}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">
            {t("events.calendar.select_a_day")}
          </p>
        )}
      </div>
    </div>
  )
}
