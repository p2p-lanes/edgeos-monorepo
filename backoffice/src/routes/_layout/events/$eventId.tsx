import { MarkdownContent } from "@edgeos/shared-form-ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  Check,
  Clock,
  ExternalLink,
  Globe,
  Home,
  Layers,
  MapPin,
  Pencil,
  Repeat,
  Share2,
  Tag,
  Users,
  Video,
} from "lucide-react"
import { useState } from "react"

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
import { getPopupPortalUrl, getPortalBaseUrl } from "@/lib/portal-urls"
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
  const [editChoiceOpen, setEditChoiceOpen] = useState(false)

  const { data: event } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => EventsService.getEvent({ eventId }),
  })

  const { data: participantsData } = useQuery({
    queryKey: ["event-participants", eventId],
    queryFn: () => EventParticipantsService.listParticipants({ eventId }),
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
        requestBody: { occurrence_start: occ! },
      }),
    onSuccess: (child: EventPublic) => {
      showSuccessToast("Detached occurrence for editing")
      setEditChoiceOpen(false)
      queryClient.invalidateQueries({ queryKey: ["events"] })
      navigate({ to: "/events/$eventId/edit", params: { eventId: child.id } })
    },
    onError: createErrorHandler(showErrorToast),
  })

  if (!event) return <Skeleton className="h-96 w-full" />

  const isRecurringOccurrence = !!event.rrule && !!occ
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
          occ ? `?occ=${encodeURIComponent(occ)}` : ""
        }`
      : null

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

        <div className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Participants</h3>
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
