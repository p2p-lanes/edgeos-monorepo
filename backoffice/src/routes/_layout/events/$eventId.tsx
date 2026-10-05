import { MarkdownContent } from "@edgeos/shared-form-ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  Check,
  Clipboard,
  Clock,
  Download,
  ExternalLink,
  Globe,
  Home,
  Layers,
  MapPin,
  Pencil,
  QrCode,
  Repeat,
  Share2,
  Tag,
  Users,
  Video,
} from "lucide-react"
import { useRef, useState } from "react"
import QRCode from "react-qr-code"

import {
  type EventParticipantPublic,
  EventParticipantsService,
  type EventPublic,
  EventsService,
  PopupsService,
  TenantsService,
} from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { CoverImage } from "@/components/events/CoverImage"
import { EventAttendanceCard } from "@/components/events/EventAttendanceCard"
import { OtherSeriesOccurrences } from "@/components/events/OtherSeriesOccurrences"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useCustomToast from "@/hooks/useCustomToast"
import {
  getEventCheckInUrl,
  getPopupPortalUrl,
  getPortalBaseUrl,
} from "@/lib/portal-urls"
import { downloadQrPng } from "@/lib/qr-download"
import { createErrorHandler } from "@/utils"

type EventViewSearch = { occ?: string }

export const Route = createFileRoute("/_layout/events/$eventId")({
  component: EventViewPage,
  validateSearch: (raw: Record<string, unknown>): EventViewSearch =>
    typeof raw.occ === "string" ? { occ: raw.occ } : {},
  head: () => ({
    meta: [{ title: "Event - EdgeOS" }],
  }),
})

/** Format a start–end range in the event's own timezone. */
function formatRange(
  start: string,
  end: string,
  tz: string | null | undefined,
): string {
  const timeZone = tz || "UTC"
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  })
  const s = new Date(start)
  const e = new Date(end)
  const sameDay = dateFmt.format(s) === dateFmt.format(e)
  if (sameDay) {
    return `${dateFmt.format(s)} · ${timeFmt.format(s)} – ${timeFmt.format(e)}`
  }
  return `${dateFmt.format(s)} ${timeFmt.format(s)} – ${dateFmt.format(e)} ${timeFmt.format(e)}`
}

function DetailRow({
  icon: Icon,
  children,
}: {
  icon: typeof Clock
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function EventViewContent() {
  const { eventId } = Route.useParams()
  const { occ } = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { effectiveTenantId } = useWorkspace()
  const [copied, setCopied] = useState(false)
  const [checkInCopied, setCheckInCopied] = useState(false)
  const qrRef = useRef<HTMLDivElement>(null)
  const [editChoiceOpen, setEditChoiceOpen] = useState(false)

  const { data: event } = useQuery({
    queryKey: ["event", eventId, occ],
    queryFn: () => EventsService.getEvent({ eventId, occurrenceStart: occ }),
    // Invalid/stale occurrence links must reach the error boundary, not leave
    // the page on its loading skeleton indefinitely.
    throwOnError: true,
    retry: false,
  })

  const occurrenceStart = event?.resolved_occurrence_start ?? undefined

  const { data: participantsData } = useQuery({
    queryKey: ["event-participants", eventId, occurrenceStart],
    queryFn: () =>
      EventParticipantsService.listParticipants({ eventId, occurrenceStart }),
    enabled: !!event,
  })

  const { data: tenant } = useQuery({
    queryKey: ["tenants", effectiveTenantId],
    queryFn: () => TenantsService.getTenant({ tenantId: effectiveTenantId! }),
    enabled: !!effectiveTenantId,
    staleTime: 5 * 60_000,
  })

  const { data: popup } = useQuery({
    queryKey: ["popup", event?.popup_id],
    queryFn: () => PopupsService.getPopup({ popupId: event!.popup_id }),
    enabled: !!event?.popup_id,
  })

  const detachMutation = useMutation({
    mutationFn: () =>
      EventsService.detachOccurrence({
        eventId,
        requestBody: { occurrence_start: occurrenceStart! },
      }),
    onSuccess: (child: EventPublic) => {
      showSuccessToast("Detached occurrence for editing")
      setEditChoiceOpen(false)
      queryClient.invalidateQueries({ queryKey: ["events"] })
      queryClient.invalidateQueries({ queryKey: ["event-series-summary"] })
      navigate({ to: "/events/$eventId/edit", params: { eventId: child.id } })
    },
    onError: createErrorHandler(showErrorToast),
  })

  if (!event) return <Skeleton className="h-96 w-full" />

  const isRecurringOccurrence = !!event.rrule && !!occurrenceStart
  const goToEditSeries = () =>
    navigate({ to: "/events/$eventId/edit", params: { eventId } })
  const onEdit = () => {
    if (isRecurringOccurrence) setEditChoiceOpen(true)
    else goToEditSeries()
  }

  // Build a link to this event in the tenant's portal (not the backoffice),
  // mirroring the portal's own Share button.
  const portalBase = getPortalBaseUrl(tenant)
  const portalUrl =
    portalBase && popup?.slug
      ? `${getPopupPortalUrl(portalBase, popup.slug)}/events/${event.id}${
          occurrenceStart ? `?occ=${encodeURIComponent(occurrenceStart)}` : ""
        }`
      : null

  // A recurring master viewed without ?occ= is its own first occurrence, so
  // the QR still pins a single date rather than the whole series.
  const checkInOcc = occurrenceStart ?? null
  const checkInUrl =
    portalBase && popup?.slug
      ? getEventCheckInUrl(portalBase, popup.slug, event.id, checkInOcc)
      : null

  const handleCopyCheckInUrl = async () => {
    if (!checkInUrl) return
    try {
      await navigator.clipboard.writeText(checkInUrl)
      setCheckInCopied(true)
      setTimeout(() => setCheckInCopied(false), 2000)
    } catch {
      showErrorToast("Couldn't copy link")
    }
  }

  const handleDownloadQr = async () => {
    try {
      await downloadQrPng(qrRef.current, `event-check-in-${event.id}.png`)
    } catch {
      showErrorToast("Couldn't download the QR code")
    }
  }

  const handleShare = async () => {
    if (!portalUrl) {
      showErrorToast(
        "Set a portal domain for this organization to share events",
      )
      return
    }
    try {
      await navigator.clipboard.writeText(portalUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      showSuccessToast("Portal link copied")
    } catch {
      showErrorToast("Couldn't copy link")
    }
  }

  const participants = participantsData?.results ?? []
  const activeParticipants = participants.filter(
    (p: EventParticipantPublic) => p.status !== "cancelled",
  )
  const goingCount = event.attendee_count ?? activeParticipants.length

  const coverSrc = event.cover_url || event.venue_image_url || null

  return (
    <FormPageLayout
      title={event.title || "Untitled event"}
      description={formatRange(
        event.start_time,
        event.end_time,
        event.timezone,
      )}
      backTo="/events"
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleShare}
            title={portalUrl ?? "No portal domain configured"}
          >
            {copied ? (
              <Check className="mr-2 h-4 w-4" />
            ) : (
              <Share2 className="mr-2 h-4 w-4" />
            )}
            Share
          </Button>
          <Button onClick={onEdit}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
        </div>
      }
    >
      <div className="mx-auto max-w-2xl space-y-4">
        {coverSrc && (
          <CoverImage
            src={coverSrc}
            alt={event.title}
            className="aspect-[16/9] w-full rounded-xl object-cover"
            fallback={<MapPin className="h-8 w-8 text-muted-foreground/40" />}
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            status={
              event.status === "published"
                ? "active"
                : (event.status ?? "draft")
            }
          />
          {event.rrule && (
            <Badge variant="outline" className="gap-1">
              <Repeat className="h-3 w-3" />
              Recurring
            </Badge>
          )}
          {event.track_title && (
            <Badge variant="outline" className="gap-1">
              <Layers className="h-3 w-3" />
              {event.track_title}
            </Badge>
          )}
        </div>

        <div className="space-y-2 rounded-xl border bg-card p-4">
          <DetailRow icon={Clock}>
            {formatRange(event.start_time, event.end_time, event.timezone)}
            {event.timezone ? (
              <span className="text-muted-foreground"> · {event.timezone}</span>
            ) : null}
          </DetailRow>

          {event.venue_title ? (
            <DetailRow icon={MapPin}>
              <span>{event.venue_title}</span>
              {event.venue_location ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {event.venue_location}
                </span>
              ) : null}
            </DetailRow>
          ) : event.custom_location_name ? (
            <DetailRow icon={Home}>
              {event.custom_location_url ? (
                <a
                  href={event.custom_location_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:underline"
                >
                  {event.custom_location_name}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                event.custom_location_name
              )}
            </DetailRow>
          ) : null}

          {event.meeting_url && (
            <DetailRow icon={Video}>
              <a
                href={event.meeting_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
              >
                Meeting link
                <ExternalLink className="h-3 w-3" />
              </a>
            </DetailRow>
          )}

          <DetailRow icon={Globe}>
            <span className="capitalize">{event.visibility}</span>
            {portalUrl && (
              <a
                href={portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 inline-flex items-center gap-1 text-muted-foreground hover:underline"
              >
                View in portal
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </DetailRow>
        </div>

        {event.tags && event.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {event.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 rounded border border-border bg-muted/60 px-1.5 py-0.5 text-xs text-muted-foreground"
              >
                <Tag className="h-3 w-3" />
                {tag}
              </span>
            ))}
          </div>
        )}

        {event.content && (
          <div className="rounded-xl border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Description</h2>
            <MarkdownContent
              source={event.content}
              className="break-words text-muted-foreground"
            />
          </div>
        )}

        {event.status === "published" && (
          <EventAttendanceCard
            eventId={event.id}
            occurrenceStart={checkInOcc}
            timezone={event.timezone ?? "UTC"}
          />
        )}

        {/* Only in self check-in: in any other mode the check-in endpoint
            refuses the scan, so a printed QR would not work. */}
        {event.status === "published" &&
          event.attendance_mode === "self_checkin" && (
            <div className="rounded-xl border bg-card p-4">
              <div className="mb-1 flex items-center gap-2">
                <QrCode className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Check-in QR</h3>
              </div>
              <p className="mb-3 text-sm text-muted-foreground">
                Show this to attendees. Scanning it checks them into this event.
                Not the same as the gathering's ticket check-in.
              </p>
              {!checkInUrl ? (
                // No portal domain means no URL we could encode. Say so instead
                // of rendering a QR that resolves nowhere.
                <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                  Set a portal domain for this organization to generate the
                  check-in QR.
                </p>
              ) : (
                <div className="space-y-4">
                  {/* One line, ellipsised. The QR is what attendees use; the
                    URL is only here to be copied elsewhere, so it costs the
                    card nothing to keep it to a single row. Full value stays
                    reachable through the tooltip and the copy button. */}
                  <div className="flex items-center gap-1 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
                    <span
                      title={checkInUrl}
                      className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
                    >
                      {checkInUrl}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0"
                      onClick={handleCopyCheckInUrl}
                      title={checkInCopied ? "Copied" : "Copy URL"}
                      aria-label="Copy check-in URL"
                    >
                      {checkInCopied ? (
                        <Check className="h-4 w-4 text-success" />
                      ) : (
                        <Clipboard className="h-4 w-4" />
                      )}
                    </Button>
                  </div>

                  <div className="flex flex-col items-center gap-3">
                    {/* White plate in both themes: a dark-on-dark QR won't scan. */}
                    <div
                      ref={qrRef}
                      className="rounded-xl border bg-white p-4 shadow-sm"
                    >
                      <QRCode value={checkInUrl} size={176} level="M" />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadQr}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download QR
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

        <div className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Participants</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatRange(event.start_time, event.end_time, event.timezone)}
              </p>
            </div>
            <span className="text-sm text-muted-foreground">
              {goingCount}
              {event.max_participant ? ` / ${event.max_participant}` : ""}
            </span>
          </div>
          {activeParticipants.length === 0 ? (
            <p className="text-sm text-muted-foreground">No participants yet</p>
          ) : (
            <div className="space-y-2">
              {activeParticipants.slice(0, 20).map((p) => {
                const name = [p.first_name, p.last_name]
                  .filter(Boolean)
                  .join(" ")
                  .trim()
                return (
                  <div key={p.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted">
                        <Users className="h-3 w-3 text-muted-foreground" />
                      </div>
                      <span className="text-sm">{name || "Unnamed"}</span>
                    </div>
                    {p.role !== "attendee" && (
                      <Badge variant="outline" className="text-xs">
                        {p.role}
                      </Badge>
                    )}
                  </div>
                )
              })}
              {activeParticipants.length > 20 && (
                <p className="text-center text-xs text-muted-foreground">
                  +{activeParticipants.length - 20} more
                </p>
              )}
            </div>
          )}
        </div>
        {(event.rrule || event.recurrence_master_id) && (
          <OtherSeriesOccurrences
            key={`${event.id}:${occurrenceStart ?? "oneoff"}`}
            event={event}
            formatRange={formatRange}
          />
        )}
      </div>

      <Dialog open={editChoiceOpen} onOpenChange={setEditChoiceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit recurring event</DialogTitle>
            <DialogDescription>
              This is one instance of a recurring series. Would you like to edit
              only this event, or the entire series?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="outline" onClick={goToEditSeries}>
              Edit series
            </Button>
            <LoadingButton
              loading={detachMutation.isPending}
              onClick={() => detachMutation.mutate()}
            >
              Edit only this event
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FormPageLayout>
  )
}

function EventViewPage() {
  return (
    <QueryErrorBoundary>
      <EventViewContent />
    </QueryErrorBoundary>
  )
}
