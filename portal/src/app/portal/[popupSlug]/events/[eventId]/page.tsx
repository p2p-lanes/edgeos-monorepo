"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  CalendarPlus,
  CheckCircle,
  Clock,
  Mail,
  MapPin,
  Repeat,
  Send,
  Tag,
  Trash2,
  UserPlus,
  Users,
  Video,
} from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useState } from "react"
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
import { Textarea } from "@/components/ui/textarea"
import { useCityProvider } from "@/providers/cityProvider"
import { AddToCalendarModal } from "../lib/AddToCalendarModal"
import { summarizeRrule } from "../lib/summarizeRrule"
import { useEventTimezone } from "../lib/useEventTimezone"

export default function EventDetailPage() {
  const { getCity } = useCityProvider()
  const city = getCity()
  const params = useParams<{ eventId: string }>()
  const queryClient = useQueryClient()
  const { timezone, formatTime, formatDateFull } = useEventTimezone(city?.id)

  const {
    data: event,
    isLoading,
    error: eventError,
  } = useQuery({
    queryKey: ["portal-event", params.eventId],
    queryFn: () => EventsService.getPortalEvent({ eventId: params.eventId }),
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
    queryKey: ["portal-event-participants", params.eventId],
    queryFn: () =>
      EventParticipantsService.listPortalParticipants({
        eventId: params.eventId,
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

  const isOwner =
    !!event && !!currentHuman && event.owner_id === currentHuman.id

  const myParticipation = participants.find((p: EventParticipantPublic) =>
    currentHuman ? p.profile_id === currentHuman.id : false,
  )

  const myParticipationActive =
    myParticipation && myParticipation.status !== "cancelled"

  const registerMutation = useMutation({
    mutationFn: () =>
      EventParticipantsService.registerForEvent({
        eventId: params.eventId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["portal-event-participants", params.eventId],
      })
    },
  })

  const cancelMutation = useMutation({
    mutationFn: () =>
      EventParticipantsService.cancelRegistration({
        eventId: params.eventId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["portal-event-participants", params.eventId],
      })
    },
  })

  const checkInMutation = useMutation({
    mutationFn: () =>
      EventParticipantsService.checkIn({ eventId: params.eventId }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["portal-event-participants", params.eventId],
      })
    },
  })

  const { data: invitations = [] } = useQuery<EventInvitationPublic[]>({
    queryKey: ["portal-event-invitations", params.eventId],
    queryFn: () =>
      EventsService.listPortalInvitations({ eventId: params.eventId }),
    enabled: !!params.eventId && isOwner,
  })

  const [emailsInput, setEmailsInput] = useState("")
  const [addToCalOpen, setAddToCalOpen] = useState(false)

  const bulkInviteMutation = useMutation({
    mutationFn: async () => {
      const emails = emailsInput
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      if (emails.length === 0) {
        throw new Error("Enter at least one email")
      }
      return EventsService.bulkInvitePortal({
        eventId: params.eventId,
        requestBody: { emails },
      })
    },
    onSuccess: (result: EventInvitationBulkResult) => {
      const { invited, skipped_existing, not_found } = result
      toast.success(
        `Invited ${invited.length} · Skipped ${skipped_existing.length} · Not found ${not_found.length}`,
      )
      setEmailsInput("")
      queryClient.invalidateQueries({
        queryKey: ["portal-event-invitations", params.eventId],
      })
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to invite")
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
      toast.error(err instanceof Error ? err.message : "Failed to remove")
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (eventError instanceof ApiError && eventError.status === 404) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 text-center">
        <h1 className="text-lg font-semibold mb-1">Event not found</h1>
        <p className="text-sm text-muted-foreground">
          This event does not exist or you do not have access to it.
        </p>
        <Link
          href={`/portal/${city?.slug}/events`}
          className="inline-flex items-center gap-1 text-sm text-primary mt-4"
        >
          <ArrowLeft className="h-4 w-4" /> Back to events
        </Link>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 text-center">
        <p className="text-muted-foreground">Event not found</p>
      </div>
    )
  }

  const isPending =
    registerMutation.isPending ||
    cancelMutation.isPending ||
    checkInMutation.isPending
  const eventStarted = new Date(event.start_time) <= new Date()

  const coverUrl = event.cover_url || event.venue_image_url || null
  const coverCredit =
    !event.cover_url && event.venue_image_url ? event.venue_title : null

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
      <Link
        href={`/portal/${city?.slug}/events`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to events
      </Link>

      {coverUrl && (
        <div>
          <div className="w-full h-40 sm:h-52 rounded-xl overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverUrl}
              alt={event.title}
              className="w-full h-full object-cover"
            />
          </div>
          {coverCredit && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Photo: {coverCredit}
            </p>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Badge
            variant="secondary"
            className={
              event.status === "published"
                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                : ""
            }
          >
            {event.status}
          </Badge>
          {event.kind && <Badge variant="outline">{event.kind}</Badge>}
          {event.visibility && event.visibility !== "public" && (
            <Badge variant="outline" className="capitalize">
              {event.visibility}
            </Badge>
          )}
        </div>
        <h1 className="text-xl sm:text-2xl font-bold">{event.title}</h1>
      </div>

      {/* Details card */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Clock className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium">
              {formatDateFull(event.start_time)}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatTime(event.start_time)} – {formatTime(event.end_time)}
            </p>
            {timezone && (
              <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                — in {timezone} time
              </p>
            )}
          </div>
        </div>
        {event.rrule && (
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
              <Repeat className="h-4 w-4 text-blue-600" />
            </div>
            <p className="text-sm text-muted-foreground">
              {summarizeRrule(event.rrule)}
            </p>
          </div>
        )}
        {event.venue_title && (
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
              <MapPin className="h-4 w-4 text-green-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {event.venue_title}
              </p>
              {event.venue_location && (
                <p className="text-xs text-muted-foreground truncate">
                  {event.venue_location}
                </p>
              )}
            </div>
          </div>
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
              Join meeting
            </a>
          </div>
        )}

        <div className="pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddToCalOpen(true)}
          >
            <CalendarPlus className="mr-2 h-4 w-4" />
            Add to calendar
          </Button>
        </div>
      </div>

      <AddToCalendarModal
        open={addToCalOpen}
        onOpenChange={setAddToCalOpen}
        eventId={event.id}
        event={{
          title: event.title,
          startIso: event.start_time,
          endIso: event.end_time,
          description: event.content,
          location:
            [event.venue_title, event.venue_location]
              .filter(Boolean)
              .join(" — ") || null,
        }}
      />

      {event.content && (
        <div className="rounded-xl border bg-card p-4">
          <h2 className="text-sm font-semibold mb-2">Description</h2>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
            {event.content}
          </p>
        </div>
      )}

      {event.tags && event.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {event.tags.map((tag: string) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 text-xs border bg-card px-2 py-1 rounded-lg"
            >
              <Tag className="h-3 w-3" />
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* RSVP */}
      {event.status === "published" && (
        <div className="rounded-xl border bg-card p-4">
          {myParticipationActive ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle className="h-4 w-4" />
                <span className="text-sm font-medium">
                  {myParticipation?.status === "checked_in"
                    ? "Checked in"
                    : "Registered"}
                </span>
              </div>
              {myParticipation?.status === "registered" && (
                <div className="flex gap-2">
                  {eventStarted ? (
                    <Button
                      size="sm"
                      onClick={() => checkInMutation.mutate()}
                      disabled={isPending}
                    >
                      Check in
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Check-in opens at start time
                    </p>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => cancelMutation.mutate()}
                    disabled={isPending}
                  >
                    Cancel RSVP
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <Button
              onClick={() => registerMutation.mutate()}
              disabled={isPending}
              className="inline-flex items-center gap-2"
            >
              <UserPlus className="h-4 w-4" />
              RSVP
            </Button>
          )}
        </div>
      )}

      {/* Owner-only: Paste attendees to invite */}
      {isOwner && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Invite attendees</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Paste emails (one per line or comma-separated). Only humans already
            in this popup can be invited.
          </p>
          <Textarea
            value={emailsInput}
            onChange={(e) => setEmailsInput(e.target.value)}
            placeholder={"alice@example.com\nbob@example.com"}
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
              {bulkInviteMutation.isPending ? "Inviting..." : "Invite"}
            </Button>
          </div>

          {invitations.length > 0 && (
            <div className="pt-2 border-t">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Invitations ({invitations.length})
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
                      aria-label={`Remove invitation for ${inv.email}`}
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

      {/* Participants */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Participants</h3>
          <span className="text-sm text-muted-foreground">
            {activeParticipants.length}
            {event.max_participant ? ` / ${event.max_participant}` : ""}
          </span>
        </div>
        {activeParticipants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No participants yet</p>
        ) : (
          <div className="space-y-2">
            {activeParticipants
              .slice(0, 10)
              .map((p: EventParticipantPublic) => {
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
                      <span className="text-sm">{name || "Unnamed"}</span>
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
              <p className="text-xs text-muted-foreground text-center">
                +{activeParticipants.length - 10} more
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
