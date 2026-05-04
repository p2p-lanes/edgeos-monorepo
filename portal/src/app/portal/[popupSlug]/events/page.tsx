"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CalendarDays,
  CheckCircle,
  Clock,
  Eye,
  EyeOff,
  Filter,
  Layers,
  MapPin,
  Pencil,
  Plus,
  Repeat,
  Star,
  Tag,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  EventParticipantsService,
  type EventPublic,
  EventsService,
  HumansService,
  TracksService,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useCityProvider } from "@/providers/cityProvider"
import { CalendarBody } from "./lib/CalendarBody"
import { DayBody } from "./lib/DayBody"
import { EventsToolbar, type EventsView } from "./lib/EventsToolbar"
import { summarizeRrule } from "./lib/summarizeRrule"
import {
  useEventTimezone,
  usePortalEventSettings,
} from "./lib/useEventTimezone"

function groupByDate(
  events: EventPublic[],
  formatDayKey: (d: string) => string,
): [string, EventPublic[]][] {
  const groups: Record<string, EventPublic[]> = {}
  for (const event of events) {
    const key = formatDayKey(event.start_time)
    if (!groups[key]) groups[key] = []
    groups[key].push(event)
  }
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
}

const statusColors: Record<string, string> = {
  published: "bg-primary/10 text-primary",
  draft: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/10 text-destructive",
}

export default function EventsPage() {
  const { t } = useTranslation()
  const { getCity } = useCityProvider()
  const city = getCity()
  const [search, setSearch] = useState("")
  const [rsvpedOnly, setRsvpedOnly] = useState(false)
  const [mineOnly, setMineOnly] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([])
  const queryClient = useQueryClient()

  // The view tab is persisted in the URL so a refresh keeps the user on
  // their current tab. The day-view date, on the other hand, is owned
  // locally — we only seed it from `?date=` once on mount (so the
  // back-from-event-detail link still lands on the right day) and then
  // strip the param. That way a plain refresh always falls back to the
  // popup's first booking day, while session navigation (today/first-day/
  // prev/next) still works in-page.
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const view: EventsView =
    (searchParams.get("view") as EventsView | null) ?? "list"
  const setView = useCallback(
    (next: EventsView) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next === "list") params.delete("view")
      else params.set("view", next)
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  const [selectedDate, setSelectedDate] = useState<Date | null>(() => {
    if (typeof window === "undefined") return null
    const dateParam = new URLSearchParams(window.location.search).get("date")
    if (!dateParam) return null
    const m = dateParam.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) return null
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0)
    return Number.isNaN(d.getTime()) ? null : d
  })
  // One-shot URL cleanup: drop `?date=` after seeding local state so a
  // refresh no longer carries it. Runs once per mount; back-from-detail
  // re-mounts the page so its `?date=` is honored on the new mount.
  const didCleanDateUrlRef = useRef(false)
  useEffect(() => {
    if (didCleanDateUrlRef.current) return
    didCleanDateUrlRef.current = true
    const params = new URLSearchParams(searchParams.toString())
    if (!params.has("date")) return
    params.delete("date")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [router, pathname, searchParams])

  const { data: currentHuman } = useQuery({
    queryKey: ["current-human"],
    queryFn: () => HumansService.getCurrentHumanInfo(),
    staleTime: 5 * 60 * 1000,
  })
  const { timezone, formatTime, formatDateShort, formatDayKey } =
    useEventTimezone(city?.id)

  const { data: eventSettings } = usePortalEventSettings(city?.id)
  const eventsEnabled = eventSettings?.event_enabled ?? true

  const { data: tracksData } = useQuery({
    queryKey: ["portal-tracks", city?.id],
    queryFn: () =>
      TracksService.listPortalTracks({ popupId: city!.id, limit: 200 }),
    enabled: !!city?.id,
    staleTime: 5 * 60 * 1000,
  })
  const allowedTracks = tracksData?.results ?? []

  // Default landing date for the day/calendar views: the popup's first
  // booking day, parsed as a local Date. Falls back to "today" until the
  // popup data has loaded.
  const popupStartDate = useMemo(() => {
    if (!city?.start_date) return null
    const m = city.start_date.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) return null
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0)
  }, [city?.start_date])

  // Expansion window for recurring events. Passing start_after triggers the
  // backend to expand RRULEs into concrete occurrences; without it, recurring
  // events render only at their master's start (hiding the other instances
  // from the list while the calendar still showed them).
  //
  // Anchored to the popup's booking window so the list view starts on the
  // popup's first day rather than "today" — if the popup hasn't started or
  // has already ended, the list still shows its events instead of being
  // empty. Falls back to a 180-day window from today before the popup
  // record loads.
  //
  // Bounds use UTC midnight of the popup's first day and UTC midnight of
  // the day *after* end_date — independent of the browser's timezone — so
  // the filter always covers the whole calendar day starting at 00:00Z and
  // doesn't drift if the user opens the portal from a different region.
  const listWindow = useMemo(() => {
    const parseUtcMidnight = (s: string | null | undefined) => {
      if (!s) return null
      const m = s.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
      if (!m) return null
      return new Date(
        Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0),
      )
    }
    const startUtc = parseUtcMidnight(city?.start_date)
    const endUtc = parseUtcMidnight(city?.end_date)
    // For end, advance by one UTC day so events on the last day are included.
    const endExclusive = endUtc
      ? new Date(endUtc.getTime() + 24 * 60 * 60 * 1000)
      : null
    if (startUtc && endExclusive) {
      return {
        startAfter: startUtc.toISOString(),
        startBefore: endExclusive.toISOString(),
      }
    }
    const start = new Date()
    start.setUTCHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 180)
    return {
      startAfter: (startUtc ?? start).toISOString(),
      startBefore: (endExclusive ?? end).toISOString(),
    }
  }, [city?.start_date, city?.end_date])

  // The list is built from up to three independent "channels" — picking
  // events with OR semantics across the active filters so that toggling
  // "My events" + "My RSVPs" together shows the *union* (everything I
  // own + everything I'm going to) rather than the intersection.
  // - all:    no filter on → published events for everyone
  // - mine:   "My events" on → events I own (any status, filtered locally
  //           since the API has no owner filter)
  // - rsvped: "My RSVPs" on → published events I'm registered for
  const useAllChannel = !mineOnly && !rsvpedOnly
  const useMineChannel = mineOnly
  const useRsvpedChannel = rsvpedOnly

  const allQuery = useQuery({
    queryKey: [
      "portal-events",
      "all",
      city?.id,
      search,
      showHidden,
      selectedTags,
      selectedTrackIds,
      listWindow.startAfter,
      listWindow.startBefore,
    ],
    queryFn: () =>
      EventsService.listPortalEvents({
        popupId: city!.id,
        search: search || undefined,
        eventStatus: "published",
        includeHidden: showHidden || undefined,
        tags: selectedTags.length ? selectedTags : undefined,
        trackIds: selectedTrackIds.length ? selectedTrackIds : undefined,
        startAfter: listWindow.startAfter,
        startBefore: listWindow.startBefore,
        limit: 200,
      }),
    enabled: !!city?.id && eventsEnabled && view === "list" && useAllChannel,
  })

  const mineQuery = useQuery({
    queryKey: [
      "portal-events",
      "mine",
      city?.id,
      search,
      showHidden,
      selectedTags,
      selectedTrackIds,
      listWindow.startAfter,
      listWindow.startBefore,
    ],
    queryFn: () =>
      EventsService.listPortalEvents({
        popupId: city!.id,
        search: search || undefined,
        // No status filter: include my drafts / pending / rejected.
        eventStatus: undefined,
        includeHidden: showHidden || undefined,
        tags: selectedTags.length ? selectedTags : undefined,
        trackIds: selectedTrackIds.length ? selectedTrackIds : undefined,
        startAfter: listWindow.startAfter,
        startBefore: listWindow.startBefore,
        limit: 200,
      }),
    enabled: !!city?.id && eventsEnabled && view === "list" && useMineChannel,
  })

  const rsvpedQuery = useQuery({
    queryKey: [
      "portal-events",
      "rsvped",
      city?.id,
      search,
      showHidden,
      selectedTags,
      selectedTrackIds,
      listWindow.startAfter,
      listWindow.startBefore,
    ],
    queryFn: () =>
      EventsService.listPortalEvents({
        popupId: city!.id,
        search: search || undefined,
        eventStatus: "published",
        rsvpedOnly: true,
        includeHidden: showHidden || undefined,
        tags: selectedTags.length ? selectedTags : undefined,
        trackIds: selectedTrackIds.length ? selectedTrackIds : undefined,
        startAfter: listWindow.startAfter,
        startBefore: listWindow.startBefore,
        limit: 200,
      }),
    enabled: !!city?.id && eventsEnabled && view === "list" && useRsvpedChannel,
  })

  const isLoading =
    (useAllChannel && allQuery.isLoading) ||
    (useMineChannel && mineQuery.isLoading) ||
    (useRsvpedChannel && rsvpedQuery.isLoading)

  const { data: hiddenCountData } = useQuery({
    queryKey: ["portal-events-hidden-count", city?.id],
    queryFn: () => EventsService.portalHiddenEventsCount({ popupId: city!.id }),
    enabled: !!city?.id && eventsEnabled,
    staleTime: 30 * 1000,
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
      queryClient.invalidateQueries({ queryKey: ["portal-events"] })
    },
  })
  const cancelRsvpMutation = useMutation({
    mutationFn: (e: EventPublic) =>
      EventParticipantsService.cancelRegistration({
        eventId: e.id,
        requestBody: rsvpBodyFor(e),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-events"] })
    },
  })

  const hideMutation = useMutation({
    mutationFn: (eventId: string) => EventsService.hidePortalEvent({ eventId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-events"] })
      queryClient.invalidateQueries({
        queryKey: ["portal-events-hidden-count"],
      })
    },
  })
  const unhideMutation = useMutation({
    mutationFn: (eventId: string) =>
      EventsService.unhidePortalEvent({ eventId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-events"] })
      queryClient.invalidateQueries({
        queryKey: ["portal-events-hidden-count"],
      })
    },
  })

  const events = useMemo(() => {
    if (useAllChannel) return allQuery.data?.results ?? []

    // Union the active channels by (event id + occurrence start) so a
    // recurring instance and its master don't collapse into one row.
    const byKey = new Map<string, EventPublic>()
    if (useMineChannel) {
      const mine = (mineQuery.data?.results ?? []).filter(
        (e) => currentHuman != null && e.owner_id === currentHuman.id,
      )
      for (const e of mine) byKey.set(`${e.id}:${e.start_time}`, e)
    }
    if (useRsvpedChannel) {
      for (const e of rsvpedQuery.data?.results ?? []) {
        byKey.set(`${e.id}:${e.start_time}`, e)
      }
    }
    return Array.from(byKey.values()).sort((a, b) =>
      a.start_time.localeCompare(b.start_time),
    )
  }, [
    useAllChannel,
    useMineChannel,
    useRsvpedChannel,
    allQuery.data,
    mineQuery.data,
    rsvpedQuery.data,
    currentHuman,
  ])
  const grouped = groupByDate(events, formatDayKey)

  if (!eventsEnabled) {
    return (
      <div className="flex flex-col h-full max-w-4xl mx-auto p-4 sm:p-6">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <CalendarDays className="h-10 w-10 text-muted-foreground/50 mb-3" />
          <h1 className="text-xl font-semibold">
            {t("events.list.events_disabled_heading")}
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            {t("events.list.events_disabled_message", {
              cityName: city?.name ?? "",
            })}
          </p>
        </div>
      </div>
    )
  }

  return (
    // Natural flow so the outer <main> from portal/layout drives scrolling:
    // heading + toolbar scroll out of view with the list/calendar body
    // instead of being sticky at the top. `overflow-x-hidden` is a safety
    // net: any wide content inside the list/calendar body is clipped here
    // instead of letting the whole viewport scroll sideways.
    <div className="max-w-4xl mx-auto p-4 sm:p-6 overflow-x-hidden">
      <div className="mb-6">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight">
            {t("events.list.heading")}
          </h1>
          {(eventSettings?.can_publish_event ?? "everyone") === "everyone" && (
            <Button asChild size="sm" className="shrink-0 px-2 sm:px-3">
              <Link
                href={`/portal/${city?.slug}/events/new`}
                aria-label={t("events.toolbar.create_event")}
                title={t("events.toolbar.create_event")}
              >
                <Plus className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">
                  {t("events.toolbar.create_event")}
                </span>
              </Link>
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {timezone
            ? t("events.list.subheading_with_tz", {
                cityName: city?.name ?? "",
                timezone,
              })
            : t("events.list.subheading", { cityName: city?.name ?? "" })}
        </p>
      </div>

      <div className="mb-4">
        <EventsToolbar
          view={view}
          onViewChange={setView}
          search={search}
          onSearchChange={setSearch}
          rsvpedOnly={rsvpedOnly}
          onRsvpedOnlyChange={setRsvpedOnly}
          mineOnly={mineOnly}
          onMineOnlyChange={setMineOnly}
          showHidden={showHidden}
          onShowHiddenChange={setShowHidden}
          hiddenCount={hiddenCountData?.count}
          allowedTags={eventSettings?.allowed_tags ?? []}
          selectedTags={selectedTags}
          onSelectedTagsChange={setSelectedTags}
          allowedTracks={allowedTracks}
          selectedTrackIds={selectedTrackIds}
          onSelectedTrackIdsChange={setSelectedTrackIds}
        />
      </div>

      <div>
        {view === "calendar" ? (
          <CalendarBody
            popupId={city?.id}
            slug={city?.slug}
            search={search}
            rsvpedOnly={rsvpedOnly}
            tags={selectedTags}
            trackIds={selectedTrackIds}
            defaultDate={popupStartDate}
          />
        ) : view === "day" ? (
          <DayBody
            popupId={city?.id}
            slug={city?.slug}
            search={search}
            rsvpedOnly={rsvpedOnly}
            tags={selectedTags}
            trackIds={selectedTrackIds}
            selectedDate={selectedDate}
            onSelectedDateChange={setSelectedDate}
            defaultDate={popupStartDate}
          />
        ) : isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-20">
            <Filter className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">
              {t("events.list.empty_state")}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map(([date, dayEvents]) => (
              <div key={date}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-2 w-2 rounded-full bg-primary" />
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {formatDateShort(dayEvents[0].start_time)}
                  </h2>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="space-y-2 pl-5 border-l-2 border-border">
                  {dayEvents.map((event) => {
                    const isOwner =
                      currentHuman != null && event.owner_id === currentHuman.id
                    const isHidden = event.hidden === true
                    const isHighlighted = event.highlighted === true
                    const cardClass = isHidden
                      ? "relative rounded-xl border bg-card opacity-60 hover:opacity-100 transition-opacity"
                      : isHighlighted
                        ? "relative rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 hover:shadow-md transition-shadow"
                        : "relative rounded-xl border bg-card hover:shadow-md transition-shadow"
                    return (
                      <div key={event.id} className={cardClass}>
                        <Link
                          href={
                            event.occurrence_id
                              ? `/portal/${city?.slug}/events/${event.id}?occ=${encodeURIComponent(event.start_time)}`
                              : `/portal/${city?.slug}/events/${event.id}`
                          }
                          className="block p-3 sm:p-4 pb-11"
                        >
                          <div className="flex items-start justify-between gap-2 mb-1 pr-8">
                            <h3 className="font-medium text-sm sm:text-base flex items-center gap-1.5">
                              {isHighlighted && (
                                <Star
                                  className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500"
                                  aria-label={t(
                                    "events.list.highlighted_title",
                                  )}
                                />
                              )}
                              <span>{event.title}</span>
                            </h3>
                            <Badge
                              variant="secondary"
                              className={
                                statusColors[event.status as string] ?? ""
                              }
                            >
                              {event.status}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            <span>
                              {formatTime(event.start_time)} –{" "}
                              {formatTime(event.end_time)}
                            </span>
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
                          {(event.rrule || event.recurrence_master_id) && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                              <Repeat className="h-3 w-3" />
                              <span className="truncate">
                                {summarizeRrule(event.rrule) ??
                                  t("events.list.part_of_recurring_series")}
                              </span>
                            </div>
                          )}
                          {event.track_title && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
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
                                  className="inline-flex items-center gap-0.5 text-[10px] bg-muted px-1.5 py-0.5 rounded"
                                >
                                  <Tag className="h-2.5 w-2.5" />
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </Link>
                        <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                          {event.status === "published" &&
                            (event.my_rsvp_status &&
                            event.my_rsvp_status !== "cancelled" ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  cancelRsvpMutation.mutate(event)
                                }}
                                className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 text-xs font-medium text-primary hover:bg-primary/20"
                              >
                                <CheckCircle className="h-3 w-3" />
                                {t("events.rsvp.going")}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  rsvpMutation.mutate(event)
                                }}
                                className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-xs font-medium shadow-sm hover:bg-muted"
                              >
                                {t("events.rsvp.rsvp")}
                              </button>
                            ))}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              if (isHidden) unhideMutation.mutate(event.id)
                              else hideMutation.mutate(event.id)
                            }}
                            aria-label={
                              isHidden
                                ? t("events.list.unhide_event_aria", {
                                    title: event.title,
                                  })
                                : t("events.list.hide_event_aria", {
                                    title: event.title,
                                  })
                            }
                            title={
                              isHidden
                                ? t("events.list.unhide_title")
                                : t("events.list.hide_title")
                            }
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                          >
                            {isHidden ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                          {isOwner && (
                            <Link
                              href={`/portal/${city?.slug}/events/${event.id}/edit`}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={t("events.list.edit_event_aria", {
                                title: event.title,
                              })}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Link>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
