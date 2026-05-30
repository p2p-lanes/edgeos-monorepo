"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarDays, Plus } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import {
  ApiError,
  EventParticipantsService,
  type EventPublic,
  EventsService,
  HumansService,
  TracksService,
} from "@/client"
import { Button } from "@/components/ui/button"
import { useCityProvider } from "@/providers/cityProvider"
import { CalendarBody } from "./lib/CalendarBody"
import { DayBody } from "./lib/DayBody"
import { EventsToolbar, type EventsView } from "./lib/EventsToolbar"
import {
  consumeEventsViewState,
  type EventsScrollSnapshot,
  type EventsViewSnapshot,
  saveEventsViewState,
} from "./lib/eventsViewState"
import { ListBody } from "./lib/ListBody"
import {
  useEventTimezone,
  usePortalEventSettings,
} from "./lib/useEventTimezone"
import { usePopupTags } from "./lib/usePopupTags"

// useLayoutEffect on the client, useEffect on the server. Lets us restore
// scroll synchronously before the browser paints (no flash of "first event"
// while we wait for a regular useEffect tick) without React's SSR warning.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect

export default function EventsPage() {
  const { t } = useTranslation()
  const { getCity } = useCityProvider()
  const city = getCity()

  // `useSearchParams()` is router-aware: when the user returns from the
  // detail page via the `<Link>` back-button, Next.js wraps the
  // navigation in a transition and the new URL is committed to the
  // router store *before* the page renders — so this hook reflects
  // `?focus=<id>` (and `?view=`, `?date=`) from the first render, even
  // though `window.location.search` may still point at the previous
  // route during the transition. Reading from here is what makes the
  // post-navigation focus/filter restore actually fire (a hard refresh
  // doesn't have this distinction and works either way).
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // One-shot restore of UI state from sessionStorage when the user comes
  // back from an event detail page. The detail page's "Back to events"
  // link round-trips `?view=...&date=...`; we use those to look up the
  // matching snapshot (saved by the body components on link click) and
  // seed filters + scroll. `consume*` deletes the entry so a later
  // refresh doesn't restore stale state. Stored once in a ref so all
  // useState lazy initializers see the same snapshot, and StrictMode's
  // double-render doesn't consume twice.
  const restoreSnapshotRef = useRef<{
    value: EventsViewSnapshot | null
  } | null>(null)
  if (restoreSnapshotRef.current === null) {
    let value: EventsViewSnapshot | null = null
    if (typeof window !== "undefined") {
      // Prefer router-aware searchParams; fall back to window.location
      // only if it lags (e.g. SSR/hydration edge cases).
      const vFromRouter =
        (searchParams.get("view") as EventsView | null) ?? null
      const dFromRouter = searchParams.get("date")
      let v: EventsView = vFromRouter ?? "list"
      let d: string | null = dFromRouter
      if (vFromRouter == null && dFromRouter == null) {
        const fallback = new URLSearchParams(window.location.search)
        v = (fallback.get("view") as EventsView | null) ?? "list"
        d = fallback.get("date")
      }
      value = consumeEventsViewState(v, d)
    }
    restoreSnapshotRef.current = { value }
  }
  const restoredFilters = restoreSnapshotRef.current.value?.listFilters
  const restoredScroll = restoreSnapshotRef.current.value?.scroll

  // The detail page round-trips `?focus=<eventId>` on its back link so we
  // can scroll the matching card into view on return — more reliable than
  // restoring an outer scrollTop, which drifts when card heights change
  // (fonts, images, recurrence summary settling late) or the viewport
  // differs. Captured once on the very first render so router.replace()
  // calls from setView / setSelectedDate can't wipe it before we consume
  // it, and StrictMode's double-render doesn't read a stale value the
  // second time. We read from `useSearchParams()` (router-aware, set
  // synchronously by `router.push` during a client-side transition) and
  // fall back to `window.location.search` so a hard refresh on the
  // events page with the param in the URL still works.
  // `occ` is the ISO start_time of the specific recurring occurrence; without
  // it, every expanded instance of a recurring event would share the same
  // DOM id and we'd always scroll to the first one.
  const focusEventRef = useRef<{
    id: string | null
    occ: string | null
  } | null>(null)
  if (focusEventRef.current === null) {
    let id: string | null = searchParams.get("focus")
    let occ: string | null = searchParams.get("focusOcc")
    if (!id && typeof window !== "undefined") {
      const fallback = new URLSearchParams(window.location.search)
      id = fallback.get("focus")
      occ = fallback.get("focusOcc")
    }
    focusEventRef.current = { id, occ }
  }

  const [search, setSearch] = useState(() => restoredFilters?.search ?? "")
  const [rsvpedOnly, setRsvpedOnly] = useState(
    () => restoredFilters?.rsvpedOnly ?? false,
  )
  const [mineOnly, setMineOnly] = useState(
    () => restoredFilters?.mineOnly ?? false,
  )
  const [showHidden, setShowHidden] = useState(
    () => restoredFilters?.showHidden ?? false,
  )
  const [selectedTags, setSelectedTags] = useState<string[]>(
    () => restoredFilters?.selectedTags ?? [],
  )
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>(
    () => restoredFilters?.selectedTrackIds ?? [],
  )
  const queryClient = useQueryClient()

  // The view tab and the day-view/calendar-view selected day are both
  // persisted in the URL. `view` and `selectedDate` are derived from
  // `?view=` and `?date=` respectively, so a refresh, browser back, or
  // the "Back to events" link all land on the same view+day with no
  // hydration race. The setters update the URL via `router.replace`
  // (no history entries) and React re-derives on the next render.
  // (`router`, `pathname`, and `searchParams` are declared above the
  // restore-snapshot refs so those refs can read router-aware params on
  // the first render.)
  const view: EventsView =
    (searchParams.get("view") as EventsView | null) ?? "list"
  const setView = useCallback(
    (next: EventsView) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next === "list") {
        params.delete("view")
        // Date doesn't apply in list view; drop it so the URL is clean.
        params.delete("date")
      } else {
        params.set("view", next)
      }
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  // `selectedDate` is derived directly from the `?date=YYYY-MM-DD` URL
  // param (no separate React state) so the URL is the single source of
  // truth — refreshes, browser back, and the "Back to events" link all
  // round-trip the same way without hydration races. Day/calendar views
  // call `setSelectedDate` to navigate; it just updates the URL via
  // `router.replace` (no history entries) and React re-derives.
  //
  // `useSearchParams()` can occasionally lag the actual URL by one
  // render (the live URL is what `window.location.search` reflects), so
  // we fall back to reading it directly when the hook hasn't seen a
  // `date` yet. The `searchParams` dep ensures the memo recomputes once
  // the hook catches up.
  const selectedDate = useMemo<Date | null>(() => {
    let dateParam = searchParams.get("date")
    if (!dateParam && typeof window !== "undefined") {
      dateParam = new URLSearchParams(window.location.search).get("date")
    }
    if (!dateParam) return null
    const m = dateParam.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) return null
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0)
    return Number.isNaN(d.getTime()) ? null : d
  }, [searchParams])

  const setSelectedDate = useCallback(
    (next: Date) => {
      const params = new URLSearchParams(searchParams.toString())
      const ymd = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(
        2,
        "0",
      )}-${String(next.getDate()).padStart(2, "0")}`
      params.set("date", ymd)
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [searchParams, router, pathname],
  )

  // Day-view fullscreen overlay. Local state only — refreshes drop the
  // overlay (the user is back at the toolbar+grid like any other view).
  // Switching away from day view auto-collapses it so we never leave a
  // hidden overlay floating over list/calendar.
  const [isDayFullscreen, setIsDayFullscreen] = useState(false)
  useEffect(() => {
    if (view !== "day" && isDayFullscreen) setIsDayFullscreen(false)
  }, [view, isDayFullscreen])
  // Lock body scroll while fullscreen so the overlay's inner scroll
  // owns vertical movement; restore prior value on cleanup.
  useEffect(() => {
    if (!isDayFullscreen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [isDayFullscreen])
  // Esc closes the overlay.
  useEffect(() => {
    if (!isDayFullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsDayFullscreen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isDayFullscreen])
  const toggleDayFullscreen = useCallback(
    () => setIsDayFullscreen((v) => !v),
    [],
  )
  // Track mount so createPortal target (`document.body`) is available
  // (Next.js renders this page on the server first).
  const [isMounted, setIsMounted] = useState(false)
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Saves the current UI state right before the user follows an event
  // link into the detail page. Bodies pass their own dayKey + scroll
  // positions; filters live here and are stamped onto every snapshot so
  // the page restores them on return regardless of which view exited.
  const handleEventLinkClick = useCallback(
    (
      fromView: EventsView,
      dayKey: string | null,
      scroll: EventsScrollSnapshot,
    ) => {
      saveEventsViewState(fromView, dayKey, {
        scroll,
        listFilters: {
          search,
          rsvpedOnly,
          mineOnly,
          showHidden,
          selectedTags,
          selectedTrackIds,
        },
      })
    },
    [search, rsvpedOnly, mineOnly, showHidden, selectedTags, selectedTrackIds],
  )

  const { data: currentHuman } = useQuery({
    queryKey: ["current-human"],
    queryFn: () => HumansService.getCurrentHumanInfo(),
    staleTime: 5 * 60 * 1000,
  })
  const {
    timezone,
    formatTime,
    formatDateShort,
    formatDayKey,
    isLoading: tzLoading,
  } = useEventTimezone(city?.id)

  const { data: eventSettings } = usePortalEventSettings(city?.id)
  const { data: popupTags } = usePopupTags(city?.id)
  // Popup-level kill switch hides the whole events module.
  const moduleEnabled = city?.events_enabled ?? true
  // event_settings.event_enabled gates creation only; existing events
  // stay browsable so users can review what's already published.
  const creationEnabled = eventSettings?.event_enabled ?? true

  const { data: tracksData } = useQuery({
    queryKey: ["portal-tracks", city?.id],
    queryFn: () =>
      TracksService.listPortalTracks({ popupId: city!.id, limit: 200 }),
    enabled: !!city?.id,
    staleTime: 5 * 60 * 1000,
  })
  const allowedTracks = tracksData?.results ?? []

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
    enabled: !!city?.id && moduleEnabled && view === "list" && useAllChannel,
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
    enabled: !!city?.id && moduleEnabled && view === "list" && useMineChannel,
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
    enabled: !!city?.id && moduleEnabled && view === "list" && useRsvpedChannel,
  })

  const isLoading =
    (useAllChannel && allQuery.isLoading) ||
    (useMineChannel && mineQuery.isLoading) ||
    (useRsvpedChannel && rsvpedQuery.isLoading)

  const { data: hiddenCountData } = useQuery({
    queryKey: ["portal-events-hidden-count", city?.id],
    queryFn: () => EventsService.portalHiddenEventsCount({ popupId: city!.id }),
    enabled: !!city?.id && moduleEnabled,
    staleTime: 30 * 1000,
  })

  // Recurring events require occurrence_start so the RSVP targets a single
  // instance. That includes both expanded pseudo-rows (have occurrence_id)
  // AND the series master itself, whose start_time IS the first occurrence.
  // One-off events must not send it.
  const rsvpBodyFor = (e: EventPublic) =>
    e.rrule || e.occurrence_id ? { occurrence_start: e.start_time } : undefined
  const toastRsvpError = (err: unknown) => {
    const fallback = t("events.rsvp.action_error") as string
    let detail = fallback
    if (err instanceof ApiError && err.body && typeof err.body === "object") {
      const body = err.body as { detail?: unknown }
      if (typeof body.detail === "string") detail = body.detail
    }
    toast.error(detail)
  }
  const rsvpMutation = useMutation({
    mutationFn: (e: EventPublic) =>
      EventParticipantsService.registerForEvent({
        eventId: e.id,
        requestBody: rsvpBodyFor(e),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-events"] })
    },
    onError: toastRsvpError,
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
    onError: toastRsvpError,
  })
  // The row whose RSVP request is currently in flight, in the
  // `${id}:${start_time}` format ListBody matches against. Including the
  // occurrence start in the key keeps the spinner pinned to the specific
  // recurring instance the user clicked rather than every row sharing
  // the same event id.
  const pendingRsvpKey: string | null = (() => {
    const pending =
      (rsvpMutation.isPending && rsvpMutation.variables) ||
      (cancelRsvpMutation.isPending && cancelRsvpMutation.variables) ||
      null
    return pending ? `${pending.id}:${pending.start_time}` : null
  })()

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
  // Restore outer scroll position once after returning from event
  // detail. List view waits for events to load (so the page has the
  // scroll height to apply the restore); calendar/day view render their
  // body synchronously so we can scroll immediately. Day view's inner
  // grid scroll is handled separately inside DayBody.
  //
  // Runs as a layout effect so the scroll is applied before paint —
  // otherwise the user briefly sees the page at scrollTop=0 (the layout
  // <main> still has whatever Next.js's scroll-to-top left it at) and
  // then jumps. We also re-apply across a few frames because event-card
  // heights can settle late (fonts, images, recurrence summary line),
  // which would otherwise leave the browser-clamped scrollTop at the
  // wrong row. Aborts the retry loop if the user starts scrolling.
  const didRestoreOuterScrollRef = useRef(false)
  useIsomorphicLayoutEffect(() => {
    if (didRestoreOuterScrollRef.current) return
    // Focus-by-id takes priority — `scrollIntoView` on the matching card
    // is more reliable than restoring a cached scrollTop, so we skip the
    // outer restore entirely to avoid a double-scroll/fight.
    if (focusEventRef.current?.id) return
    if (!restoredScroll || restoredScroll.outer == null) return
    if (view === "list" && (isLoading || events.length === 0)) return
    didRestoreOuterScrollRef.current = true
    const main =
      typeof document !== "undefined"
        ? document.getElementById("portal-scroll")
        : null
    if (!main) return
    const target = restoredScroll.outer
    main.scrollTop = target
    let lastApplied = main.scrollTop
    let frames = 0
    let cancelled = false
    const tick = () => {
      if (cancelled || !main) return
      // User scrolled away from where we last set it — stop fighting.
      if (main.scrollTop !== lastApplied) return
      if (main.scrollTop !== target) {
        main.scrollTop = target
        lastApplied = main.scrollTop
      }
      if (++frames < 6) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return () => {
      cancelled = true
    }
  }, [view, restoredScroll, isLoading, events.length])

  // Scroll the focused event-card into view after returning from the
  // detail page. The detail's back link stamps `?focus=<eventId>` (and
  // `&focusOcc=<ISO start_time>` for a specific recurring occurrence) and
  // ListBody/CalendarBody/DayBody render each card with
  // id={`event-card-${event.id}`} — or `event-card-${id}__${start_time}`
  // for expanded recurring instances. We use scrollIntoView (not a cached
  // scrollTop) so it stays correct even if card heights settle late or
  // the viewport changed. The card may not be mounted on the first pass
  // (recurrence summary, image, fonts, query result still loading), so
  // we retry across a handful of frames before giving up. Either way
  // the `focus` params are cleaned from the URL via router.replace so a
  // later refresh doesn't re-scroll, and so the URL stays tidy.
  const didConsumeFocusRef = useRef(false)
  useIsomorphicLayoutEffect(() => {
    if (didConsumeFocusRef.current) return
    const focusId = focusEventRef.current?.id
    const focusOcc = focusEventRef.current?.occ
    if (!focusId) return
    // For list view, the query must finish first; otherwise the card
    // is guaranteed not to be in the DOM yet.
    if (view === "list" && (isLoading || events.length === 0)) return

    const cleanFocusParam = () => {
      if (typeof window === "undefined") return
      const params = new URLSearchParams(window.location.search)
      if (!params.has("focus") && !params.has("focusOcc")) return
      params.delete("focus")
      params.delete("focusOcc")
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    }

    const targetDomId = focusOcc
      ? `event-card-${focusId}__${focusOcc}`
      : `event-card-${focusId}`

    let cancelled = false
    let frames = 0
    const MAX_FRAMES = 30
    const tryFocus = () => {
      if (cancelled) return
      const el = document.getElementById(targetDomId)
      if (el) {
        didConsumeFocusRef.current = true
        el.scrollIntoView({ behavior: "auto", block: "center" })
        cleanFocusParam()
        return
      }
      if (++frames >= MAX_FRAMES) {
        // Card never mounted (filtered out, missing, etc.). Clean the
        // URL anyway so a later interaction doesn't keep retrying.
        didConsumeFocusRef.current = true
        cleanFocusParam()
        return
      }
      requestAnimationFrame(tryFocus)
    }
    tryFocus()
    return () => {
      cancelled = true
    }
  }, [view, isLoading, events.length, router, pathname])

  if (!moduleEnabled) {
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
    // instead of being sticky at the top. `overflow-x-clip` (not -hidden)
    // is a safety net for wide content while preserving position:sticky
    // for descendants — `overflow: hidden` would establish a scroll
    // container and break sticky behavior on the calendar column.
    <div className="max-w-4xl mx-auto p-4 sm:p-6 overflow-x-clip">
      <div className="mb-6">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight">
            {t("events.list.heading")}
          </h1>
          {creationEnabled &&
            (eventSettings?.can_publish_event ?? "everyone") === "everyone" && (
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

      {!isDayFullscreen && (
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
            allowedTags={popupTags ?? []}
            selectedTags={selectedTags}
            onSelectedTagsChange={setSelectedTags}
            allowedTracks={allowedTracks}
            selectedTrackIds={selectedTrackIds}
            onSelectedTrackIdsChange={setSelectedTrackIds}
          />
        </div>
      )}

      <div>
        {view === "calendar" ? (
          <CalendarBody
            popupId={city?.id}
            slug={city?.slug}
            search={search}
            rsvpedOnly={rsvpedOnly}
            tags={selectedTags}
            trackIds={selectedTrackIds}
            defaultDate={selectedDate}
            onEventLinkClick={handleEventLinkClick}
            placeholderUrl={eventSettings?.placeholder_url}
          />
        ) : view === "day" ? (
          isDayFullscreen ? null : (
            <DayBody
              popupId={city?.id}
              slug={city?.slug}
              search={search}
              rsvpedOnly={rsvpedOnly}
              tags={selectedTags}
              trackIds={selectedTrackIds}
              selectedDate={selectedDate}
              onSelectedDateChange={setSelectedDate}
              restoredScroll={restoredScroll}
              onEventLinkClick={handleEventLinkClick}
              isFullscreen={false}
              onToggleFullscreen={toggleDayFullscreen}
            />
          )
        ) : (
          <ListBody
            events={events}
            slug={city?.slug}
            isLoading={isLoading || tzLoading}
            formatTime={formatTime}
            formatDateShort={formatDateShort}
            formatDayKey={formatDayKey}
            mode="authed"
            onEventLinkClick={handleEventLinkClick}
            currentHumanId={currentHuman?.id}
            onRsvp={(e) => rsvpMutation.mutate(e)}
            onCancelRsvp={(e) => cancelRsvpMutation.mutate(e)}
            pendingRsvpKey={pendingRsvpKey}
            onHide={(id) => hideMutation.mutate(id)}
            onUnhide={(id) => unhideMutation.mutate(id)}
            placeholderUrl={eventSettings?.placeholder_url}
          />
        )}
      </div>

      {isMounted &&
        isDayFullscreen &&
        view === "day" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col gap-3 bg-background p-3 sm:p-4 overflow-y-auto"
            role="dialog"
            aria-modal="true"
          >
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
              allowedTags={popupTags ?? []}
              selectedTags={selectedTags}
              onSelectedTagsChange={setSelectedTags}
              allowedTracks={allowedTracks}
              selectedTrackIds={selectedTrackIds}
              onSelectedTrackIdsChange={setSelectedTrackIds}
            />
            <DayBody
              popupId={city?.id}
              slug={city?.slug}
              search={search}
              rsvpedOnly={rsvpedOnly}
              tags={selectedTags}
              trackIds={selectedTrackIds}
              selectedDate={selectedDate}
              onSelectedDateChange={setSelectedDate}
              restoredScroll={restoredScroll}
              onEventLinkClick={handleEventLinkClick}
              isFullscreen={true}
              onToggleFullscreen={toggleDayFullscreen}
            />
          </div>,
          document.body,
        )}
    </div>
  )
}
