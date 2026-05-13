"use client"

// Side-effect import: this route renders outside the portal layout's
// <Providers> tree, so i18next is never initialized otherwise and every
// t("...") call would render the literal key.
import "@/i18n/config"

import { CalendarDays, Filter } from "lucide-react"
import { notFound, useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { CalendarBody } from "@/app/portal/[popupSlug]/events/lib/CalendarBody"
import { DayBody } from "@/app/portal/[popupSlug]/events/lib/DayBody"
import {
  EventsToolbar,
  type EventsView,
} from "@/app/portal/[popupSlug]/events/lib/EventsToolbar"
import { ListBody } from "@/app/portal/[popupSlug]/events/lib/ListBody"
import { useEventTimezone } from "@/app/portal/[popupSlug]/events/lib/useEventTimezone"
import { ApiError, type EventPublic } from "@/client"
import {
  LoginRequiredDialog,
  type LoginRequiredEvent,
} from "@/components/LoginRequiredDialog"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { useTenant } from "@/providers/tenantProvider"

import { usePublicCalendarEvents } from "./usePublicCalendarEvents"

interface PublicCalendarClientProps {
  popupSlug: string
}

/**
 * Public calendar shell. Renders the same toolbar / list / calendar /
 * day views as ``/portal/[popupSlug]/events`` but in read-only mode:
 * no RSVP, no hide/edit, no "My events" or "My RSVPs" filters. Clicks
 * on an event open a LoginRequiredDialog that sends the visitor to
 * ``/auth?redirect=...`` and back to the event detail on success.
 */
export function PublicCalendarClient({ popupSlug }: PublicCalendarClientProps) {
  const { t } = useTranslation()
  const { tenantId } = useTenant()
  const router = useRouter()
  const isAuthenticated = useIsAuthenticated()

  const [view, setView] = useState<EventsView>("list")
  const [search, setSearch] = useState("")
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [loginPrompt, setLoginPrompt] = useState<LoginRequiredEvent | null>(
    null,
  )

  // Default window: 180 days from today. The endpoint expands recurring
  // events server-side when ``start_after`` is set, so we always pass it.
  const window = useMemo(() => {
    const start = new Date()
    start.setUTCHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 180)
    return {
      startAfter: start.toISOString(),
      startBefore: end.toISOString(),
    }
  }, [])

  const query = usePublicCalendarEvents({
    popupSlug,
    tenantId,
    startAfter: window.startAfter,
    startBefore: window.startBefore,
    search,
    tags: selectedTags,
    trackIds: selectedTrackIds,
  })

  // Translate a 404 from the API into a Next "not found" — the slug
  // either doesn't exist or doesn't belong to this tenant.
  if (query.error instanceof ApiError && query.error.status === 404) {
    notFound()
  }

  const meta = query.data?.meta
  const timezone = meta?.timezone

  // Override the static "Calendar" title set by generateMetadata once
  // we know the popup name. The server-side metadata can't reach an
  // anonymous "get popup by slug" endpoint, so we patch it here.
  useEffect(() => {
    if (typeof document === "undefined") return
    document.title = meta?.popup_name
      ? t("events.public_calendar.page_title", { popupName: meta.popup_name })
      : t("events.public_calendar.page_title_fallback")
  }, [meta?.popup_name, t])
  // Cast each public-calendar row into the loose ``EventPublic`` shape
  // expected by the shared body components. Anything those components
  // try to read that we didn't populate is gated behind ``mode="public"``
  // (which our calls pass), so undefined fields never get rendered.
  const events = useMemo<EventPublic[]>(() => {
    const rows = query.data?.results ?? []
    return rows.map(
      (r) =>
        ({
          id: r.id,
          title: r.title,
          start_time: r.start_time,
          end_time: r.end_time,
          timezone: r.timezone,
          kind: r.kind ?? null,
          cover_url: r.cover_url ?? null,
          max_participant: r.max_participant ?? null,
          tags: r.tags ?? [],
          highlighted: r.highlighted ?? false,
          host_display_name: r.host_display_name ?? null,
          rrule: r.rrule ?? null,
          recurrence_master_id: r.recurrence_master_id ?? null,
          occurrence_id: r.occurrence_id ?? null,
          venue_id: r.venue_id ?? null,
          venue_title: r.venue_title ?? null,
          venue_location: r.venue_location ?? null,
          venue_image_url: r.venue_image_url ?? null,
          custom_location_name: r.custom_location_name ?? null,
          track_id: r.track_id ?? null,
          track_title: r.track_title ?? null,
          status: "published",
          visibility: "public",
          // Fields the public schema intentionally hides:
          tenant_id: "",
          popup_id: meta?.popup_id ?? "",
          owner_id: "",
          content: null,
          meeting_url: null,
          custom_location_url: null,
          require_approval: false,
          rejection_reason: null,
          recurrence_exdates: [],
          ical_sequence: 0,
          created_at: r.start_time,
          updated_at: r.start_time,
          hidden: false,
          my_rsvp_status: null,
        }) as unknown as EventPublic,
    )
  }, [query.data, meta?.popup_id])

  const handleEventClick = useCallback(
    (event: EventPublic) => {
      if (isAuthenticated) {
        let href = `/portal/${popupSlug}/events/${event.id}`
        if (event.occurrence_id) {
          href += `?occ=${encodeURIComponent(event.start_time)}`
        }
        router.push(href)
        return true
      }
      setLoginPrompt({
        id: event.id,
        title: event.title,
        start_time: event.start_time,
        occurrence_id: event.occurrence_id,
      })
      // Returning true tells the body components to prevent the underlying
      // <Link> navigation — we surface the login dialog instead.
      return true
    },
    [isAuthenticated, popupSlug, router],
  )

  const { formatTime, formatDateShort, formatDayKey } = useEventTimezone(
    meta?.popup_id,
    timezone,
  )

  const allowedTracks = useMemo(
    () => (meta?.allowed_tracks ?? []).map((t) => ({ id: t.id, name: t.name })),
    [meta?.allowed_tracks],
  )
  // Stable fallback for ``allowedTags`` so the toolbar's identity-equal
  // memos don't tear down on every parent render.
  const allowedTags = useMemo(
    () => meta?.allowed_tags ?? [],
    [meta?.allowed_tags],
  )
  // Derive venues from the loaded events. Memoized on ``events`` so the
  // DayBody useMemo deps that read ``venuesOverride`` only invalidate
  // when the underlying event set actually changes.
  const venuesOverride = useMemo(() => collectVenues(events), [events])

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 overflow-x-clip">
      {meta?.popup_name ? (
        <h1 className="text-3xl font-bold tracking-tight mb-4">
          {t("events.public_calendar.page_title", {
            popupName: meta.popup_name,
          })}
        </h1>
      ) : null}
      <div className="mb-6">
        <h2 className="text-2xl font-bold tracking-tight">
          {t("events.public_calendar.heading")}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {timezone && meta?.popup_name
            ? t("events.public_calendar.subheading_with_tz", {
                popupName: meta.popup_name,
                timezone,
              })
            : meta?.popup_name
              ? t("events.public_calendar.subheading", {
                  popupName: meta.popup_name,
                })
              : null}
        </p>
      </div>

      <div className="mb-4">
        <EventsToolbar
          view={view}
          onViewChange={setView}
          search={search}
          onSearchChange={setSearch}
          allowedTags={allowedTags}
          selectedTags={selectedTags}
          onSelectedTagsChange={setSelectedTags}
          allowedTracks={allowedTracks}
          selectedTrackIds={selectedTrackIds}
          onSelectedTrackIdsChange={setSelectedTrackIds}
        />
      </div>

      <div>
        {query.isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : query.isError ? (
          <div className="text-center py-20">
            <CalendarDays className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">
              {t("events.list.empty_state")}
            </p>
          </div>
        ) : view === "calendar" ? (
          <CalendarBody
            popupId={meta?.popup_id}
            slug={popupSlug}
            search={search}
            rsvpedOnly={false}
            tags={selectedTags}
            trackIds={selectedTrackIds}
            defaultDate={selectedDate}
            mode="public"
            eventsOverride={events}
            onEventClick={handleEventClick}
            timezoneOverride={timezone}
          />
        ) : view === "day" ? (
          <DayBody
            popupId={meta?.popup_id}
            slug={popupSlug}
            search={search}
            rsvpedOnly={false}
            tags={selectedTags}
            trackIds={selectedTrackIds}
            selectedDate={selectedDate}
            onSelectedDateChange={setSelectedDate}
            mode="public"
            eventsOverride={events}
            venuesOverride={venuesOverride}
            onEventClick={handleEventClick}
            timezoneOverride={timezone}
          />
        ) : events.length === 0 ? (
          <div className="text-center py-20">
            <Filter className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">
              {t("events.list.empty_state")}
            </p>
          </div>
        ) : (
          <ListBody
            events={events}
            slug={popupSlug}
            formatTime={formatTime}
            formatDateShort={formatDateShort}
            formatDayKey={formatDayKey}
            mode="public"
            onEventClick={handleEventClick}
          />
        )}
      </div>

      <LoginRequiredDialog
        event={loginPrompt}
        popupSlug={popupSlug}
        popupName={meta?.popup_name}
        onClose={() => setLoginPrompt(null)}
      />
    </div>
  )
}

/**
 * Derive a venue list from the events themselves — the public calendar
 * has no venue endpoint, but DayBody needs ``venuesOverride`` so its
 * per-venue columns can be rendered.
 */
function collectVenues(events: EventPublic[]): { id: string; title: string }[] {
  const seen = new Map<string, string>()
  for (const e of events) {
    if (e.venue_id && e.venue_title && !seen.has(e.venue_id)) {
      seen.set(e.venue_id, e.venue_title)
    }
  }
  return Array.from(seen.entries()).map(([id, title]) => ({ id, title }))
}
