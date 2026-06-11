"use client"

import { MarkdownContent } from "@edgeos/shared-form-ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle,
  Clock,
  Globe,
  Home,
  Layers,
  Lock,
  Mail,
  Map as MapIcon,
  MapPin,
  Pencil,
  Repeat,
  Send,
  Share2,
  Tag,
  Trash2,
  User,
  UserPlus,
  Users,
  Video,
  X,
} from "lucide-react"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import {
  ApiError,
  type EventInvitationBulkResult,
  type EventInvitationPublic,
  type EventParticipantPublic,
  EventParticipantsService,
  EventsService,
  HumansService,
} from "@/client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Pill } from "@/components/ui/pill"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useCityProvider } from "@/providers/cityProvider"
import { AddToCalendarModal } from "../lib/AddToCalendarModal"
import { CoverImage } from "../lib/CoverImage"
import { canManageEvent } from "../lib/eventPermissions"
import { summarizeRrule } from "../lib/summarizeRrule"
import { useCalendarAddedFlag } from "../lib/useCalendarAddedFlag"
import {
  useEventTimezone,
  usePortalEventSettings,
} from "../lib/useEventTimezone"

function AdminNotesSection({ eventId }: { eventId: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [value, setValue] = useState("")
  const [dirty, setDirty] = useState(false)

  // Staff-only: this endpoint 403s for regular humans, so a non-staff user
  // never reaches isSuccess and the section stays hidden. retry:false keeps the
  // expected 403 from being retried.
  const { data, isSuccess } = useQuery({
    queryKey: ["portal-event-admin-notes", eventId],
    queryFn: () => EventsService.getPortalEventAdminNotes({ eventId }),
    retry: false,
  })

  useEffect(() => {
    if (data && !dirty) setValue(data.notes ?? "")
  }, [data, dirty])

  const saveMutation = useMutation({
    mutationFn: () =>
      EventsService.updatePortalEventAdminNotes({
        eventId,
        requestBody: { notes: value.trim() ? value : null },
      }),
    onSuccess: (res) => {
      setDirty(false)
      queryClient.setQueryData(["portal-event-admin-notes", eventId], res)
      toast.success(t("events.detail.admin_notes_saved_toast"))
    },
    onError: () => toast.error(t("events.detail.admin_notes_error_toast")),
  })

  if (!isSuccess) return null

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">
          {t("events.detail.admin_notes_heading")}
        </h3>
        <span className="text-xs text-muted-foreground">
          {t("events.detail.admin_notes_staff_only")}
        </span>
      </div>
      <Textarea
        value={value}
        rows={4}
        placeholder={t("events.detail.admin_notes_placeholder") as string}
        onChange={(e) => {
          setValue(e.target.value)
          setDirty(true)
        }}
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!dirty || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending
            ? t("events.detail.admin_notes_saving_button")
            : t("events.detail.admin_notes_save_button")}
        </Button>
      </div>
    </div>
  )
}

export default function EventDetailPage() {
  const { t } = useTranslation()
  const { getCity } = useCityProvider()
  const city = getCity()
  const params = useParams<{ eventId: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  // Originating events-page URL search (e.g. "view=day&date=2026-05-15"),
  // set by Day-view links so "Back to events" can return to the same spot.
  // We also stamp `focus=<eventId>` so the events page can scroll the
  // matching card into view; the page consumes the param once and cleans
  // it from the URL, so it survives a refresh on this detail page but
  // never sticks around on the list once used.
  const fromSearch = searchParams.get("from") ?? ""
  // For an expanded recurring instance, the calendar passes the occurrence's
  // ISO start time via ?occ=. We render that in place of the master's
  // start_time (and shift end_time by the same offset) so the user sees the
  // specific instance they clicked, not the series' first occurrence.
  const occParam = searchParams.get("occ")
  // Stamp focusOcc alongside focus so the list can scroll to the *specific*
  // occurrence card on return — without it, all occurrences of a recurring
  // series share the same event id and the list lands on the first one.
  const focusQs = occParam
    ? `focus=${encodeURIComponent(params.eventId)}&focusOcc=${encodeURIComponent(occParam)}`
    : `focus=${encodeURIComponent(params.eventId)}`
  const backHref = fromSearch
    ? `/portal/${city?.slug}/events?${fromSearch}&${focusQs}`
    : `/portal/${city?.slug}/events?${focusQs}`
  const queryClient = useQueryClient()
  const {
    timezone,
    formatTime,
    formatDateFull,
    isLoading: tzLoading,
  } = useEventTimezone(city?.id)
  const { data: eventSettings } = usePortalEventSettings(city?.id)

  const {
    data: event,
    isLoading,
    error: eventError,
  } = useQuery({
    queryKey: ["portal-event", params.eventId, occParam],
    queryFn: () =>
      EventsService.getPortalEvent({
        eventId: params.eventId,
        occurrenceStart: occParam ?? undefined,
      }),
    enabled: !!params.eventId,
    retry: (failureCount, err) => {
      if (
        err instanceof ApiError &&
        (err.status === 404 || err.status === 403)
      ) {
        return false
      }
      return failureCount < 2
    },
  })

  const { data: participantsData } = useQuery({
    queryKey: ["portal-event-participants", params.eventId, occParam],
    queryFn: () =>
      EventParticipantsService.listPortalParticipants({
        eventId: params.eventId,
        occurrenceStart: occParam ?? undefined,
      }),
    enabled: !!params.eventId && !!event,
  })

  const { data: currentHuman } = useQuery({
    queryKey: ["current-human"],
    queryFn: () => HumansService.getCurrentHumanInfo(),
  })

  const participants = participantsData?.results ?? []
  const activeParticipants = participants.filter(
    (p: EventParticipantPublic) => p.status !== "cancelled",
  )

  const canManage = !!event && canManageEvent(event, currentHuman?.id)

  // RSVP state is sourced from the event's own `my_rsvp_status` field so
  // this page agrees with the list/day/calendar views (which read the
  // same field). The participants list above is still used for the
  // attendee roster / count, not for deciding the caller's own status.
  const myRsvpStatus = event?.my_rsvp_status ?? null
  const isRsvped = !!myRsvpStatus && myRsvpStatus !== "cancelled"

  // Capacity is enforced server-side against every active registration,
  // including attendees who hid their name (and are therefore absent from
  // the roster above). Prefer the backend count so the badge and the "full"
  // state stay consistent with what registration actually allows.
  const goingCount = event?.attendee_count ?? activeParticipants.length
  const isFull =
    event?.max_participant != null && goingCount >= event.max_participant

  // Recurring events require occurrence_start so the RSVP targets a single
  // instance; one-off events must not send it (the backend rejects mixing
  // the two semantics). Prefer the ?occ= param (set when the user came from
  // an expanded occurrence); fall back to the event's own start_time when
  // landing on a recurring master without ?occ=, since its start IS the
  // first occurrence.
  const rsvpBody = occParam
    ? { occurrence_start: occParam }
    : event?.rrule
      ? { occurrence_start: event.start_time }
      : undefined
  const invalidateRsvpQueries = () => {
    queryClient.invalidateQueries({
      queryKey: ["portal-event-participants", params.eventId],
    })
    queryClient.invalidateQueries({ queryKey: ["portal-event"] })
    queryClient.invalidateQueries({ queryKey: ["portal-events"] })
    queryClient.invalidateQueries({ queryKey: ["portal-events-day"] })
    queryClient.invalidateQueries({ queryKey: ["portal-events-calendar"] })
  }

  const registerMutation = useMutation({
    mutationFn: () =>
      EventParticipantsService.registerForEvent({
        eventId: params.eventId,
        requestBody: rsvpBody,
      }),
    onSuccess: invalidateRsvpQueries,
  })

  const cancelMutation = useMutation({
    mutationFn: () =>
      EventParticipantsService.cancelRegistration({
        eventId: params.eventId,
        requestBody: rsvpBody,
      }),
    onSuccess: invalidateRsvpQueries,
  })

  const [cancelEventOpen, setCancelEventOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyingEmails, setCopyingEmails] = useState(false)
  // Whether the participants list is expanded to show everyone or truncated.
  const [participantsExpanded, setParticipantsExpanded] = useState(false)
  const cancelEventMutation = useMutation({
    mutationFn: () =>
      EventsService.cancelPortalEvent({ eventId: params.eventId }),
    onSuccess: () => {
      toast.success(t("events.detail.cancel_event_success"))
      queryClient.invalidateQueries({ queryKey: ["portal-events"] })
      queryClient.invalidateQueries({ queryKey: ["portal-events-day"] })
      queryClient.invalidateQueries({ queryKey: ["portal-events-calendar"] })
      setCancelEventOpen(false)
      router.push(backHref)
    },
    onError: (err: unknown) => {
      const fallback = t("events.detail.cancel_event_error") as string
      let detail = fallback
      if (err instanceof ApiError && err.body && typeof err.body === "object") {
        const body = err.body as { detail?: unknown }
        if (typeof body.detail === "string") detail = body.detail
      }
      toast.error(detail)
    },
  })

  const checkInMutation = useMutation({
    mutationFn: () =>
      EventParticipantsService.checkIn({
        eventId: params.eventId,
        requestBody: rsvpBody,
      }),
    onSuccess: invalidateRsvpQueries,
  })

  const { data: invitations = [] } = useQuery<EventInvitationPublic[]>({
    queryKey: ["portal-event-invitations", params.eventId],
    queryFn: () =>
      EventsService.listPortalInvitations({ eventId: params.eventId }),
    enabled: !!params.eventId && canManage,
  })

  const [emailsInput, setEmailsInput] = useState("")
  const [addToCalOpen, setAddToCalOpen] = useState(false)
  // Tracks whether the user has clicked through one of the provider
  // options. We can't verify the calendar entry was actually saved, so
  // we treat "clicked Google/Outlook/Yahoo/.ics" as added and let them
  // manually clear the flag from the modal if they remove it later.
  const [calendarAdded, markCalendarAdded, markCalendarRemoved] =
    useCalendarAddedFlag(event?.id, occParam)

  const bulkInviteMutation = useMutation({
    mutationFn: async () => {
      const emails = emailsInput
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      if (emails.length === 0) {
        throw new Error(t("events.detail.enter_at_least_one_email") as string)
      }
      return EventsService.bulkInvitePortal({
        eventId: params.eventId,
        requestBody: { emails },
      })
    },
    onSuccess: (result: EventInvitationBulkResult) => {
      const { invited, skipped_existing, not_found } = result
      toast.success(
        t("events.detail.bulk_invite_success", {
          invited: invited.length,
          skipped: skipped_existing.length,
          notFound: not_found.length,
        }),
      )
      setEmailsInput("")
      queryClient.invalidateQueries({
        queryKey: ["portal-event-invitations", params.eventId],
      })
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof Error
          ? err.message
          : (t("events.detail.bulk_invite_error") as string),
      )
    },
  })

  const deleteInvitationMutation = useMutation({
    mutationFn: (invitationId: string) =>
      EventsService.deletePortalInvitation({
        eventId: params.eventId,
        invitationId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["portal-event-invitations", params.eventId],
      })
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof Error
          ? err.message
          : (t("events.detail.remove_invitation_error") as string),
      )
    },
  })

  if (isLoading || tzLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (eventError instanceof ApiError && eventError.status === 404) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 text-center">
        <h1 className="text-lg font-semibold mb-1">
          {t("events.detail.event_not_found")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("events.detail.event_not_found_message")}
        </p>
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-primary mt-4"
        >
          <ArrowLeft className="h-4 w-4" /> {t("events.common.back_to_events")}
        </Link>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 text-center">
        <p className="text-muted-foreground">
          {t("events.detail.event_not_found")}
        </p>
      </div>
    )
  }

  const isPending =
    registerMutation.isPending ||
    cancelMutation.isPending ||
    checkInMutation.isPending

  // Effective start/end: if `?occ=<iso>` is present, this is a recurring
  // occurrence — shift end_time by (master end - master start) to preserve
  // duration. Otherwise show the row's own times.
  const effectiveStartTime = occParam ?? event.start_time
  const effectiveEndTime = (() => {
    if (!occParam) return event.end_time
    const masterDuration =
      new Date(event.end_time).getTime() - new Date(event.start_time).getTime()
    return new Date(new Date(occParam).getTime() + masterDuration).toISOString()
  })()
  const eventStarted = new Date(effectiveStartTime) <= new Date()

  const coverUrl =
    event.cover_url ||
    event.venue_image_url ||
    eventSettings?.placeholder_url ||
    null
  const coverCredit =
    !event.cover_url && event.venue_image_url ? event.venue_title : null

  const sharePath = `/portal/${city?.slug}/events/${params.eventId}${
    occParam ? `?occ=${encodeURIComponent(occParam)}` : ""
  }`
  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${sharePath}`
      : sharePath

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.success(t("events.detail.share_link_copied"))
    } catch {
      toast.error(t("events.detail.share_link_error"))
    }
  }

  // Managers (owner/host/collaborator) copy every active RSVPer's email in
  // one click. The endpoint is gated server-side to the same roles and
  // returns all registrants — including those who hid their name from the
  // directory — so the organiser can actually reach everyone.
  const handleCopyAttendeeEmails = async () => {
    setCopyingEmails(true)
    try {
      const res = await EventParticipantsService.listPortalAttendeeEmails({
        eventId: params.eventId,
        occurrenceStart: occParam ?? undefined,
      })
      if (res.emails.length === 0) {
        toast.info(t("events.detail.copy_attendee_emails_empty"))
        return
      }
      await navigator.clipboard.writeText(res.emails.join(", "))
      toast.success(
        t("events.detail.copy_attendee_emails_done", { count: res.count }),
      )
    } catch {
      toast.error(t("events.detail.copy_attendee_emails_error"))
    } finally {
      setCopyingEmails(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={backHref}
          // Next.js's default `scroll={true}` triggers a scroll-to-top
          // on navigation, scheduled in a layout-level layout-effect
          // that runs *after* the page's own layout-effects. That
          // overrode the events page's `scrollIntoView` on the focused
          // card and left the user back at scrollTop=0 even though
          // `?focus=` was consumed. Disabling auto-scroll here lets the
          // page own the scroll position; `focus=` is always present on
          // this back href so the page will scroll the card into view
          // itself.
          scroll={false}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {t("events.common.back_to_events")}
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          <Button asChild variant="outline" size="sm">
            <a
              href={`https://ee26.geobrowser.io/events/${event.id}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("events.detail.view_on_geobrowser")}
            >
              <Globe className="mr-2 h-3.5 w-3.5" />
              {t("events.detail.view_on_geobrowser")}
            </a>
          </Button>
          {canManage && event.status !== "cancelled" && (
            <Dialog open={cancelEventOpen} onOpenChange={setCancelEventOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={cancelEventMutation.isPending}
                  aria-label={t("events.detail.cancel_event_button")}
                >
                  <Ban className="mr-2 h-3.5 w-3.5" />
                  {t("events.detail.cancel_event_button")}
                </Button>
              </DialogTrigger>
              <DialogContent hasCloseButton={false}>
                <DialogHeader>
                  <DialogTitle>
                    {t("events.detail.cancel_event_dialog_title")}
                  </DialogTitle>
                  <DialogDescription>
                    {t("events.detail.cancel_event_dialog_description")}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setCancelEventOpen(false)}
                    disabled={cancelEventMutation.isPending}
                  >
                    {t("events.detail.cancel_event_dialog_keep")}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => cancelEventMutation.mutate()}
                    disabled={cancelEventMutation.isPending}
                  >
                    {cancelEventMutation.isPending
                      ? t("events.detail.cancel_event_dialog_loading")
                      : t("events.detail.cancel_event_dialog_confirm")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          {canManage && (
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/portal/${city?.slug}/events/${event.id}/edit`}
                aria-label={t("events.detail.edit_event_button")}
              >
                <Pencil className="mr-2 h-3.5 w-3.5" />
                {t("events.detail.edit_event_button")}
              </Link>
            </Button>
          )}
        </div>
      </div>

      {event.status === "pending_approval" && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="text-sm">
            <p className="font-semibold">
              {t("events.detail.pending_approval_banner_title")}
            </p>
            <p className="text-amber-900/90 dark:text-amber-100/90">
              {t("events.detail.pending_approval_banner_message")}
            </p>
          </div>
        </div>
      )}

      {canManage && event.status === "rejected" && event.rejection_reason && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 p-3 text-red-900 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-100">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
          <div className="text-sm">
            <p className="font-semibold">
              {t("events.detail.rejection_reason_label")}
            </p>
            <p className="text-red-900/90 dark:text-red-100/90">
              {event.rejection_reason}
            </p>
          </div>
        </div>
      )}

      {coverUrl && (
        <div>
          <div className="w-full h-40 sm:h-52 rounded-xl overflow-hidden">
            <CoverImage
              src={coverUrl}
              alt={event.title}
              className="w-full h-full object-cover"
              fallback={
                <CalendarDays className="h-10 w-10 text-muted-foreground/40" />
              }
            />
          </div>
          {coverCredit && (
            <p className="text-[11px] text-muted-foreground mt-1">
              {t("events.detail.photo_credit", { venueName: coverCredit })}
            </p>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          {event.status === "published"
            ? event.visibility &&
              event.visibility !== "public" && (
                <Badge
                  variant="outline"
                  className={cn(
                    "px-3 py-1 text-xs shadow-sm capitalize cursor-default",
                    event.visibility === "private"
                      ? "bg-amber-100 text-amber-800 border-transparent hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300"
                      : "bg-card",
                  )}
                >
                  {event.visibility}
                </Badge>
              )
            : event.status !== "pending_approval" && (
                <Badge
                  variant="secondary"
                  className="px-3 py-1 text-xs shadow-sm capitalize cursor-default hover:bg-secondary"
                >
                  {event.status}
                </Badge>
              )}
          {event.kind && (
            <Badge
              variant="outline"
              className="px-3 py-1 text-xs shadow-sm bg-card capitalize cursor-default"
            >
              {event.kind}
            </Badge>
          )}
        </div>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl sm:text-2xl font-bold">{event.title}</h1>
          {event.status === "published" && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleShare}
              aria-label={t("events.detail.share_button")}
              className="shrink-0"
            >
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Share2 className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Details card */}
      <div className="relative rounded-xl border bg-card p-4 space-y-3">
        {event.status === "published" && (
          <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5">
            {isRsvped ? (
              <>
                <div className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <CheckCircle className="h-4 w-4" />
                  {myRsvpStatus === "checked_in"
                    ? t("events.rsvp.checked_in")
                    : t("events.rsvp.going")}
                </div>
                {myRsvpStatus === "registered" && eventStarted && (
                  <Button
                    size="sm"
                    onClick={() => checkInMutation.mutate()}
                    disabled={isPending}
                  >
                    {t("events.rsvp.check_in")}
                  </Button>
                )}
              </>
            ) : isFull ? (
              <Button
                disabled
                variant="secondary"
                className="inline-flex items-center gap-2"
              >
                <Users className="h-4 w-4" />
                {t("events.rsvp.full")}
              </Button>
            ) : (
              <Button
                onClick={() => registerMutation.mutate()}
                disabled={isPending}
                className="inline-flex items-center gap-2"
              >
                <UserPlus className="h-4 w-4" />
                {t("events.rsvp.rsvp")}
              </Button>
            )}
          </div>
        )}
        <div className="flex items-center gap-2.5 pr-36">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Clock className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium">
              {formatDateFull(effectiveStartTime)}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatTime(effectiveStartTime)} – {formatTime(effectiveEndTime)}
            </p>
            {timezone && (
              <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                {t("events.common.in_timezone_time", { timezone })}
              </p>
            )}
          </div>
        </div>
        {(() => {
          // Optional creator-chosen host name shown to participants. Falls
          // back to the popup name so events created before this field
          // existed (or with the field left blank) still show a host line.
          const hostName =
            event.host_display_name?.trim() || city?.name?.trim() || null
          if (!hostName) return null
          return (
            <div className="flex items-center gap-2.5 pr-36">
              <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                <User className="h-4 w-4 text-amber-600" />
              </div>
              <p className="text-sm">
                <span className="text-muted-foreground">
                  {t("events.detail.hosted_by", { defaultValue: "Hosted by " })}
                </span>
                <span className="font-medium">{hostName}</span>
              </p>
            </div>
          )
        })()}
        {event.rrule && (
          <div className="flex items-center gap-2.5 pr-36">
            <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
              <Repeat className="h-4 w-4 text-blue-600" />
            </div>
            <p className="text-sm text-muted-foreground">
              {summarizeRrule(event.rrule, t)}
            </p>
          </div>
        )}
        {event.venue_title &&
          (() => {
            const mapsQuery = [event.venue_title, event.venue_location]
              .filter(Boolean)
              .join(", ")
            const mapsUrl = mapsQuery
              ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`
              : null
            // Preserve the current event URL (incl. occ + originating
            // events-list `from`) so the venue page can return here.
            const eventDetailQs = new URLSearchParams()
            if (occParam) eventDetailQs.set("occ", occParam)
            if (fromSearch) eventDetailQs.set("from", fromSearch)
            const eventDetailQsStr = eventDetailQs.toString()
            const eventDetailHref = eventDetailQsStr
              ? `/portal/${city?.slug}/events/${event.id}?${eventDetailQsStr}`
              : `/portal/${city?.slug}/events/${event.id}`
            const venueHref = event.venue_id
              ? `/portal/${city?.slug}/events/venues/${event.venue_id}?from=${encodeURIComponent(eventDetailHref)}`
              : null
            const venueInner = (
              <>
                <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
                  <MapPin className="h-4 w-4 text-green-600" />
                </div>
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-sm font-medium truncate",
                      venueHref && "group-hover:underline",
                    )}
                  >
                    {event.venue_title}
                  </p>
                  {event.venue_location && (
                    <p className="text-xs text-muted-foreground truncate">
                      {event.venue_location}
                    </p>
                  )}
                </div>
              </>
            )
            return (
              <div className="flex items-center gap-2">
                {venueHref ? (
                  <Link
                    href={venueHref}
                    className="group flex min-w-0 flex-1 items-center gap-2.5 -mx-2 px-2 py-1.5 rounded-md transition-colors hover:bg-muted/50"
                  >
                    {venueInner}
                  </Link>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    {venueInner}
                  </div>
                )}
                {mapsUrl && (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("events.detail.open_in_maps")}
                    title={t("events.detail.open_in_maps") as string}
                    className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                  >
                    <MapIcon className="h-4 w-4" />
                  </a>
                )}
              </div>
            )
          })()}
        {!event.venue_title && event.custom_location_name && (
          <a
            href={event.custom_location_url ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("events.detail.open_in_maps")}
            className="group flex items-center gap-2.5 pr-36 -mx-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors"
          >
            <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Home className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate group-hover:underline">
                {event.custom_location_name}
              </p>
            </div>
          </a>
        )}
        {event.meeting_url && (
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
              <Video className="h-4 w-4 text-purple-600" />
            </div>
            <a
              href={event.meeting_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline"
            >
              {t("events.detail.join_meeting")}
            </a>
          </div>
        )}
        {/* Bottom-right: Manual add to calendar — secondary action, low-key */}
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={() => setAddToCalOpen(true)}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground",
              calendarAdded &&
                "text-emerald-600 hover:text-emerald-700 dark:text-emerald-400",
            )}
          >
            {calendarAdded ? (
              <CalendarCheck className="h-3.5 w-3.5" />
            ) : (
              <CalendarPlus className="h-3.5 w-3.5" />
            )}
            {calendarAdded
              ? t("events.detail.added_to_calendar_button")
              : t("events.detail.manual_add_to_calendar_button")}
          </button>
        </div>
      </div>

      <AddToCalendarModal
        open={addToCalOpen}
        onOpenChange={setAddToCalOpen}
        eventId={event.id}
        event={{
          title: event.title,
          startIso: effectiveStartTime,
          endIso: effectiveEndTime,
          description: event.content,
          location:
            [event.venue_title, event.venue_location]
              .filter(Boolean)
              .join(" — ") || null,
        }}
        isAdded={calendarAdded}
        onAdded={markCalendarAdded}
        onRemoved={markCalendarRemoved}
      />

      {event.content && (
        <div className="rounded-xl border bg-card p-4">
          <h2 className="text-sm font-semibold mb-2">
            {t("events.detail.description_heading")}
          </h2>
          <MarkdownContent
            source={event.content}
            className="text-muted-foreground break-words"
          />
        </div>
      )}

      {(event.track_title || (event.tags && event.tags.length > 0)) && (
        <div className="flex flex-wrap gap-2">
          {event.track_title && (
            <Pill tone="primary" icon={<Layers className="h-3.5 w-3.5" />}>
              {event.track_title}
            </Pill>
          )}
          {event.tags?.map((tag: string) => (
            <Pill key={tag} icon={<Tag className="h-3.5 w-3.5" />}>
              {tag}
            </Pill>
          ))}
        </div>
      )}

      {/* Below-card RSVP utilities: hint on the left, Cancel RSVP on the right.
          Separated by justify-between so they don't visually crowd each other. */}
      {event.status === "published" && myRsvpStatus === "registered" && (
        <div className="flex items-center justify-between gap-4">
          {!eventStarted ? (
            <span className="text-xs text-muted-foreground">
              {t("events.rsvp.check_in_opens_at_start")}
            </span>
          ) : (
            <span />
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => cancelMutation.mutate()}
            disabled={isPending}
            className="border-destructive/30 bg-destructive/10 text-destructive shadow-none hover:border-destructive/50 hover:bg-destructive/20 hover:text-destructive dark:border-destructive/40 dark:bg-destructive/20 dark:hover:bg-destructive/30"
          >
            <X className="h-3.5 w-3.5" />
            {t("events.rsvp.cancel")}
          </Button>
        </div>
      )}

      {/* Managers only (owner / host / collaborators): paste attendees to invite */}
      {canManage && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">
              {t("events.detail.invite_attendees_heading")}
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("events.detail.invite_attendees_text")}
          </p>
          <Textarea
            value={emailsInput}
            onChange={(e) => setEmailsInput(e.target.value)}
            placeholder={t("events.detail.email_placeholder")}
            rows={5}
            disabled={bulkInviteMutation.isPending}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => bulkInviteMutation.mutate()}
              disabled={
                bulkInviteMutation.isPending || emailsInput.trim().length === 0
              }
            >
              <Send className="mr-2 h-4 w-4" />
              {bulkInviteMutation.isPending
                ? t("events.detail.inviting_button")
                : t("events.detail.invite_button")}
            </Button>
          </div>

          {invitations.length > 0 && (
            <div className="pt-2 border-t">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                {t("events.detail.invitations_heading", {
                  count: invitations.length,
                })}
              </h4>
              <ul className="space-y-1 max-h-48 overflow-y-auto">
                {invitations.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="truncate">
                      {inv.first_name || inv.last_name
                        ? `${inv.first_name ?? ""} ${inv.last_name ?? ""}`.trim()
                        : inv.email}
                    </span>
                    <span className="text-muted-foreground truncate ml-auto">
                      {inv.email}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 shrink-0"
                      aria-label={t("events.detail.remove_invitation_aria", {
                        email: inv.email,
                      })}
                      disabled={deleteInvitationMutation.isPending}
                      onClick={() => deleteInvitationMutation.mutate(inv.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <AdminNotesSection eventId={event.id} />

      {/* Participants */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">
            {t("events.detail.participants_heading")}
          </h3>
          <span className="text-sm text-muted-foreground">
            {goingCount}
            {event.max_participant ? ` / ${event.max_participant}` : ""}
          </span>
        </div>
        {canManage && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyAttendeeEmails}
            disabled={copyingEmails}
            className="mb-3 w-full"
          >
            <Mail className="mr-2 h-4 w-4" />
            {t("events.detail.copy_attendee_emails")}
          </Button>
        )}
        {activeParticipants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("events.detail.no_participants_yet")}
          </p>
        ) : (
          <div className="space-y-2">
            {(participantsExpanded
              ? activeParticipants
              : activeParticipants.slice(0, 10)
            ).map((p: EventParticipantPublic) => {
              const name = [p.first_name, p.last_name]
                .filter(Boolean)
                .join(" ")
                .trim()
              return (
                <div key={p.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center">
                      <Users className="h-3 w-3 text-muted-foreground" />
                    </div>
                    <span className="text-sm">
                      {name || t("events.detail.unnamed_participant")}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {p.role !== "attendee" && (
                      <Badge variant="outline" className="text-xs">
                        {p.role}
                      </Badge>
                    )}
                    {p.status === "checked_in" && (
                      <CheckCircle className="h-3 w-3 text-green-500" />
                    )}
                  </div>
                </div>
              )
            })}
            {activeParticipants.length > 10 && (
              <button
                type="button"
                aria-expanded={participantsExpanded}
                onClick={() => setParticipantsExpanded((prev) => !prev)}
                className="block w-full text-center text-xs text-muted-foreground hover:text-foreground hover:underline cursor-pointer transition-colors"
              >
                {participantsExpanded
                  ? t("events.detail.participants_show_less")
                  : t("events.detail.participants_more", {
                      count: activeParticipants.length - 10,
                    })}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
