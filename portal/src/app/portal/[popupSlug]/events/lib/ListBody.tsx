"use client"

import {
  CalendarDays,
  CheckCircle,
  ChevronDown,
  Clock,
  Crown,
  Eye,
  EyeOff,
  Filter,
  Layers,
  Loader2,
  MapPin,
  Pencil,
  Repeat,
  Tag,
} from "lucide-react"
import Link from "next/link"
import { Fragment, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import type { EventPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { CoverImage } from "./CoverImage"
import { canManageEvent } from "./eventPermissions"
import type { EventsScrollSnapshot } from "./eventsViewState"
import { summarizeRrule } from "./summarizeRrule"

const statusColors: Record<string, string> = {
  published: "bg-primary/10 text-primary",
  draft: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/10 text-destructive",
  pending_approval:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
}

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

/**
 * Pick the day-header to scroll to after the user collapses `collapsedDate`:
 * the first still-open day after it (in render order), or — when no open day
 * follows — the collapsed day itself, so its own header pins to the top
 * instead of leaving the viewport stranded in the gap the events left behind.
 * Returns null only when `collapsedDate` isn't in `orderedDays` (defensive;
 * the caller then skips scrolling).
 *
 * `collapsedDays` is the set BEFORE `collapsedDate` is added; days after it are
 * unaffected by this toggle, so their membership reflects their open state.
 */
export function nextOpenDayTarget(
  collapsedDate: string,
  orderedDays: string[],
  collapsedDays: Set<string>,
): string | null {
  const startIdx = orderedDays.indexOf(collapsedDate)
  if (startIdx === -1) return null
  return (
    orderedDays.slice(startIdx + 1).find((d) => !collapsedDays.has(d)) ??
    collapsedDate
  )
}

interface ListBodyProps {
  events: EventPublic[]
  slug: string | undefined
  isLoading?: boolean
  formatTime: (d: string) => string
  formatDateShort: (d: string) => string
  formatDayKey: (d: string) => string
  /**
   * "authed" enables the per-event RSVP / hide / edit controls and the
   * owner crown. "public" renders read-only cards (no status badge for
   * non-published, no controls) and delegates clicks to ``onEventClick``.
   */
  mode?: "authed" | "public"
  /** Sessionstorage snapshot hook fired on link click. */
  onEventLinkClick?: (
    view: "list",
    dayKey: null,
    scroll: EventsScrollSnapshot,
  ) => void
  /** Return ``true`` to intercept the default link navigation. */
  onEventClick?: (event: EventPublic) => boolean | undefined
  // Authenticated-only props:
  currentHumanId?: string | null
  onRsvp?: (event: EventPublic) => void
  onCancelRsvp?: (event: EventPublic) => void
  /**
   * Key (``${event.id}:${event.start_time}``) of the row whose RSVP
   * mutation is currently in flight. The matching button renders a
   * spinner and is disabled until the request settles.
   */
  pendingRsvpKey?: string | null
  /**
   * When false, the RSVP (register) button is disabled — the human lacks a
   * ticket for this popup or has a rejected application. The "Going"/cancel
   * button is never gated. Defaults to true.
   */
  canRsvp?: boolean
  /** Tooltip text shown on the disabled RSVP button explaining why. */
  rsvpDisabledReason?: string
  onHide?: (eventId: string) => void
  onUnhide?: (eventId: string) => void
  /** Popup-scoped fallback image when an event has no cover/venue image. */
  placeholderUrl?: string | null
  /**
   * When true, on first mount the list scrolls to the first upcoming event
   * (start at or after now) and renders a subtle "now" divider in today's
   * group. Suppressed by the parent while restoring scroll or focusing a
   * specific card after returning from event detail.
   */
  autoScrollToUpcoming?: boolean
  /**
   * Px offset from the top of the scroll container at which each day header
   * freezes. Should match the sticky filter toolbar's height so the headers
   * stack right below it instead of behind it. Defaults to 0.
   */
  stickyTop?: number
}

/**
 * Grouped-by-day event list. Used by the authenticated portal events
 * page and by the anonymous public calendar — the two differ only in
 * which inline controls render (gated by ``mode``) and where clicks go
 * (``onEventClick`` lets the public flow intercept and surface a login
 * prompt instead of navigating to the auth-gated detail page).
 */
export function ListBody({
  events,
  slug,
  isLoading,
  formatTime,
  formatDateShort,
  formatDayKey,
  mode = "authed",
  onEventLinkClick,
  onEventClick,
  currentHumanId,
  onRsvp,
  onCancelRsvp,
  pendingRsvpKey,
  canRsvp = true,
  rsvpDisabledReason,
  onHide,
  onUnhide,
  placeholderUrl,
  autoScrollToUpcoming = false,
  stickyTop = 0,
}: ListBodyProps) {
  const { t } = useTranslation()
  const isAuthed = mode === "authed"
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set())
  // Day-header elements keyed by day key, so collapsing a day can scroll the
  // next still-open day's header to the top of the viewport.
  const dayHeaderRefs = useRef<Map<string, HTMLElement>>(new Map())

  // "Now" reference for the today divider + auto-scroll. Ticks once a
  // minute so the divider creeps down as events start, without re-rendering
  // every frame. Times are absolute instants, so the comparison is
  // timezone-agnostic; `formatDayKey` (popup tz) decides which group is
  // "today".
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const nowMs = now.getTime()
  const todayKey = formatDayKey(now.toISOString())
  // First event (globally, list is start-sorted) that hasn't started yet —
  // the scroll target. May be today or, once today is over, a later day.
  const firstUpcoming =
    events.find((e) => new Date(e.start_time).getTime() >= nowMs) ?? null
  const firstUpcomingIsToday =
    firstUpcoming != null && formatDayKey(firstUpcoming.start_time) === todayKey
  const firstUpcomingDomId = firstUpcoming
    ? firstUpcoming.occurrence_id
      ? `event-card-${firstUpcoming.id}__${firstUpcoming.start_time}`
      : `event-card-${firstUpcoming.id}`
    : null

  // Scroll the anchor (the today divider, or the first upcoming card on a
  // later day) into view once on first mount, unless the parent is
  // restoring/focusing scroll.
  const autoScrollRef = useRef<HTMLDivElement | null>(null)
  const didAutoScrollRef = useRef(false)
  useEffect(() => {
    if (didAutoScrollRef.current) return
    if (!autoScrollToUpcoming) return
    // Wait for the list to actually render before the anchor ref exists.
    if (isLoading || events.length === 0) return
    const el = autoScrollRef.current
    if (!el) return
    didAutoScrollRef.current = true
    el.scrollIntoView({ block: "start", behavior: "smooth" })
  }, [autoScrollToUpcoming, isLoading, events.length])

  const nowDivider = (withRef: boolean) => (
    <div
      ref={withRef ? autoScrollRef : undefined}
      // scroll-margin clears the frozen filters bar so the auto-scroll lands
      // the divider just below it instead of behind it.
      className="flex items-center gap-2 py-1 scroll-mt-28"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
      <span className="text-[10px] font-semibold uppercase tracking-wide text-red-500 shrink-0">
        {t("events.list.now")} · {formatTime(now.toISOString())}
      </span>
      <span className="flex-1 h-px bg-red-500/30" />
    </div>
  )
  const toggleDay = (date: string) => {
    setCollapsedDays((prev) => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  // Collapsing a day strands the viewport in the gap its removed events left
  // behind. Toggle as usual, but on collapse snap to the top of the next
  // still-open day (or this day's own header when nothing open follows) so the
  // next day reads from the start. `orderedDays` is the rendered day order;
  // `willBeOpen` is Radix's next open state (false ⇒ we're collapsing). The
  // collapse is instant (no height animation), so one rAF after the commit is
  // enough for layout to settle before we scroll.
  const handleDayToggle = (
    date: string,
    willBeOpen: boolean,
    orderedDays: string[],
  ) => {
    toggleDay(date)
    if (willBeOpen) return
    const startIdx = orderedDays.indexOf(date)
    if (startIdx === -1) return
    const targetDate =
      orderedDays.slice(startIdx + 1).find((d) => !collapsedDays.has(d)) ?? date
    requestAnimationFrame(() => {
      dayHeaderRefs.current
        .get(targetDate)
        ?.scrollIntoView({ block: "start", behavior: "auto" })
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-20">
        <Filter className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
        <p className="text-muted-foreground">{t("events.list.empty_state")}</p>
      </div>
    )
  }

  const grouped = groupByDate(events, formatDayKey)
  const orderedDays = grouped.map(([day]) => day)

  return (
    <div className="space-y-6">
      {grouped.map(([date, dayEvents]) => {
        const isOpen = !collapsedDays.has(date)
        const dayLabel = formatDateShort(dayEvents[0].start_time)
        const isToday = date === todayKey
        // Index of the first not-yet-started event in today's group; the
        // divider goes right before it. -1 (none upcoming) → all of today's
        // events are past, so the divider sits at the end of the group.
        const upcomingIdx = isToday
          ? dayEvents.findIndex(
              (e) => new Date(e.start_time).getTime() >= nowMs,
            )
          : -1
        const dividerAt = isToday
          ? upcomingIdx === -1
            ? dayEvents.length
            : upcomingIdx
          : -1
        // The today divider is the scroll anchor only when today actually
        // has an upcoming event; otherwise the anchor is a later-day card.
        const dividerIsAnchor = isToday && upcomingIdx !== -1
        return (
          <Collapsible
            key={date}
            open={isOpen}
            onOpenChange={(open) => handleDayToggle(date, open, orderedDays)}
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                aria-label={t(
                  isOpen
                    ? "events.list.collapse_day_aria"
                    : "events.list.expand_day_aria",
                  { date: dayLabel },
                )}
                // Sticky per-day header. Each Collapsible is its own
                // containing block, so a header only stays frozen while its
                // own day is in view — the next day's header pushes it up as
                // it arrives (and pulls it back when scrolling up). `top`
                // matches the sticky toolbar height; z-10 keeps it under the
                // toolbar (z-20) so the outgoing header slides beneath it.
                ref={(el) => {
                  if (el) dayHeaderRefs.current.set(date, el)
                  else dayHeaderRefs.current.delete(date)
                }}
                style={{ top: stickyTop, scrollMarginTop: stickyTop }}
                className="sticky z-10 w-full flex items-center gap-3 mb-3 py-1.5 bg-background group cursor-pointer"
              >
                <div className="h-2 w-2 rounded-full bg-primary" />
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {dayLabel}
                </h2>
                <div className="flex-1 h-px bg-border" />
                <ChevronDown
                  className={cn(
                    "w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 group-hover:text-foreground",
                    isOpen && "rotate-180",
                  )}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-2 pl-5 border-l-2 border-border">
                {dayEvents.map((event, idx) => {
                  const isOwner =
                    isAuthed &&
                    currentHumanId != null &&
                    event.owner_id === currentHumanId
                  // Edit affordance follows manage rights (owner / host /
                  // collaborator); the crown badge stays owner-only.
                  const canManage =
                    isAuthed && canManageEvent(event, currentHumanId)
                  const domId = event.occurrence_id
                    ? `event-card-${event.id}__${event.start_time}`
                    : `event-card-${event.id}`
                  // Scroll anchor for the "all of today is over" case: the
                  // first upcoming event lives in a later-day group, so it
                  // carries the ref instead of the today divider.
                  const isUpcomingAnchor =
                    !firstUpcomingIsToday && domId === firstUpcomingDomId
                  const isHidden = isAuthed && event.hidden === true
                  const isHighlighted = event.highlighted === true
                  const cardClass = isHidden
                    ? "relative rounded-xl border bg-card opacity-60 hover:opacity-100 transition-opacity"
                    : isHighlighted
                      ? "relative rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 hover:shadow-md transition-shadow"
                      : "relative rounded-xl border bg-card hover:shadow-md transition-shadow"
                  const href = event.occurrence_id
                    ? `/portal/${slug}/events/${event.id}?occ=${encodeURIComponent(event.start_time)}`
                    : `/portal/${slug}/events/${event.id}`
                  const handleClick = (
                    e: React.MouseEvent<HTMLAnchorElement>,
                  ) => {
                    if (onEventClick) {
                      const handled = onEventClick(event)
                      if (handled === true) {
                        e.preventDefault()
                        return
                      }
                    }
                    if (onEventLinkClick) {
                      const main =
                        typeof document !== "undefined"
                          ? document.querySelector("main")
                          : null
                      onEventLinkClick("list", null, {
                        outer: main?.scrollTop ?? 0,
                      })
                    }
                  }
                  const thumbUrl =
                    event.cover_url ||
                    event.venue_image_url ||
                    placeholderUrl ||
                    null
                  return (
                    // Key by occurrence (id + start_time), not just id: a
                    // recurring series shares one id across instances, so a
                    // plain id key would collide between sibling occurrences.
                    <Fragment key={domId}>
                      {idx === dividerAt && nowDivider(dividerIsAnchor)}
                      <div
                        id={domId}
                        ref={isUpcomingAnchor ? autoScrollRef : undefined}
                        className={cn(
                          cardClass,
                          isUpcomingAnchor && "scroll-mt-28",
                        )}
                      >
                        <Link
                          href={href}
                          onClick={handleClick}
                          className={
                            isAuthed
                              ? "block p-3 sm:p-4 pb-11"
                              : "block p-3 sm:p-4"
                          }
                        >
                          <div className="flex items-start gap-3">
                            <div className="h-14 w-14 sm:h-16 sm:w-16 shrink-0 rounded-lg overflow-hidden">
                              <CoverImage
                                src={thumbUrl}
                                alt={event.title}
                                className="w-full h-full object-cover"
                                sizes="64px"
                                fallback={
                                  <CalendarDays className="h-5 w-5 text-muted-foreground/40" />
                                }
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <h3 className="font-medium text-sm sm:text-base flex items-center gap-1.5">
                                  {isOwner && (
                                    <Crown
                                      className="h-3.5 w-3.5 shrink-0 text-amber-500"
                                      aria-label={t("events.list.owned_title")}
                                    />
                                  )}
                                  <span>{event.title}</span>
                                </h3>
                                {isAuthed && (
                                  <Badge
                                    variant="secondary"
                                    className={
                                      statusColors[event.status as string] ?? ""
                                    }
                                  >
                                    {t(`events.status.${event.status}`)}
                                  </Badge>
                                )}
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
                                    {summarizeRrule(event.rrule, t) ??
                                      t("events.list.part_of_recurring_series")}
                                  </span>
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
                        </Link>
                        {isAuthed && (
                          <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                            {event.status === "published" &&
                              (() => {
                                const rsvpKey = `${event.id}:${event.start_time}`
                                const isRsvpPending = pendingRsvpKey === rsvpKey
                                const isRsvped =
                                  event.my_rsvp_status &&
                                  event.my_rsvp_status !== "cancelled"
                                return isRsvped ? (
                                  <button
                                    type="button"
                                    disabled={isRsvpPending}
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      onCancelRsvp?.(event)
                                    }}
                                    className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60"
                                  >
                                    {isRsvpPending ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <CheckCircle className="h-3 w-3" />
                                    )}
                                    {t("events.rsvp.going")}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={isRsvpPending || !canRsvp}
                                    title={
                                      !canRsvp ? rsvpDisabledReason : undefined
                                    }
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      onRsvp?.(event)
                                    }}
                                    className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-xs font-medium shadow-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {isRsvpPending && (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    )}
                                    {t("events.rsvp.rsvp")}
                                  </button>
                                )
                              })()}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                if (isHidden) onUnhide?.(event.id)
                                else onHide?.(event.id)
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
                            {canManage && (
                              <Link
                                href={`/portal/${slug}/events/${event.id}/edit`}
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
                        )}
                      </div>
                    </Fragment>
                  )
                })}
                {dividerAt === dayEvents.length && nowDivider(false)}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )
      })}
    </div>
  )
}
