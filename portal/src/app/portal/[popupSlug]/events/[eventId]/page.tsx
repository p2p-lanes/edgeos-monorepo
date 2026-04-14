"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { format, parseISO } from "date-fns"
import {
  ArrowLeft,
  CheckCircle,
  Clock,
  MapPin,
  Tag,
  UserPlus,
  Users,
  Video,
} from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"

import {
  EventParticipantsService,
  EventsService,
  type EventParticipantPublic,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useCityProvider } from "@/providers/cityProvider"

function formatDateFull(dateStr: string) {
  return format(parseISO(dateStr), "EEEE, MMMM d, yyyy")
}
function formatTime(dateStr: string) {
  return format(parseISO(dateStr), "HH:mm")
}

export default function EventDetailPage() {
  const { getCity } = useCityProvider()
  const city = getCity()
  const params = useParams<{ eventId: string }>()
  const queryClient = useQueryClient()

  const { data: event, isLoading } = useQuery({
    queryKey: ["portal-event", params.eventId],
    queryFn: () =>
      EventsService.getPortalEvent({ eventId: params.eventId }),
    enabled: !!params.eventId,
  })

  const { data: participantsData } = useQuery({
    queryKey: ["portal-event-participants", params.eventId],
    queryFn: () =>
      EventParticipantsService.listPortalParticipants({
        eventId: params.eventId,
      }),
    enabled: !!params.eventId,
  })

  const participants = participantsData?.results ?? []
  const activeParticipants = participants.filter(
    (p: EventParticipantPublic) => p.status !== "cancelled"
  )

  const myParticipation = participants.find(
    (p: EventParticipantPublic) => p.status !== "cancelled"
    // Note: filtering by profile_id would require knowing current human id
    // For now we show RSVP status based on API response
  )

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
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

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
      <Link
        href={`/portal/${city?.slug}/events`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to events
      </Link>

      {event.cover_url && (
        <div className="w-full h-40 sm:h-52 rounded-xl overflow-hidden">
          <img
            src={event.cover_url}
            alt={event.title}
            className="w-full h-full object-cover"
          />
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
          {event.kind && (
            <Badge variant="outline">{event.kind}</Badge>
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
            <p className="text-sm font-medium">{formatDateFull(event.start_time)}</p>
            <p className="text-xs text-muted-foreground">
              {formatTime(event.start_time)} – {formatTime(event.end_time)}
            </p>
          </div>
        </div>
        {event.location && (
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
              <MapPin className="h-4 w-4 text-green-600" />
            </div>
            <p className="text-sm">{event.location}</p>
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
      </div>

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
          {myParticipation ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle className="h-4 w-4" />
                <span className="text-sm font-medium">
                  {myParticipation.status === "checked_in"
                    ? "Checked in"
                    : "Registered"}
                </span>
              </div>
              {myParticipation.status === "registered" && (
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
            {activeParticipants.slice(0, 10).map((p: EventParticipantPublic) => (
              <div key={p.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center">
                    <Users className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <span className="text-sm">
                    {p.profile_id.slice(0, 8)}...
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
            ))}
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
