import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { format } from "date-fns"
import { CalendarDays } from "lucide-react"
import { Suspense } from "react"

import { type EventPublic, TracksService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { TrackForm } from "@/components/forms/TrackForm"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

export const Route = createFileRoute("/_layout/events/tracks/$trackId/edit")({
  component: EditTrackPage,
  head: () => ({
    meta: [{ title: "Edit Track - EdgeOS" }],
  }),
})

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—"
  try {
    return format(new Date(dateStr), "MMM d, yyyy HH:mm")
  } catch {
    return "—"
  }
}

const statusVariant: Record<string, "default" | "secondary" | "destructive"> = {
  published: "default",
  draft: "secondary",
  cancelled: "destructive",
}

function TrackEventsList({ trackId }: { trackId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["tracks", trackId, "events"],
    queryFn: () => TracksService.listTrackEvents({ trackId }),
  })

  if (isLoading) {
    return <Skeleton className="h-40 w-full" />
  }
  if (isError) {
    return (
      <p className="text-sm text-muted-foreground">
        Could not load events for this track.
      </p>
    )
  }

  const events = data?.results ?? []
  if (events.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No events in this track"
        description="Assign events to this track from the event editor."
      />
    )
  }

  return (
    <ul className="divide-y rounded-md border">
      {events.map((event: EventPublic) => (
        <li
          key={event.id}
          className="flex items-center justify-between gap-4 p-4"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <Link
              to="/events/$eventId/edit"
              params={{ eventId: event.id }}
              className="truncate font-medium hover:underline"
            >
              {event.title}
            </Link>
            <span className="text-xs text-muted-foreground">
              {formatDateTime(event.start_time)}
            </span>
          </div>
          <Badge
            variant={statusVariant[event.status as string] ?? "secondary"}
          >
            {event.status}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

function EditTrackContent({ trackId }: { trackId: string }) {
  const navigate = useNavigate()
  const { data: track } = useSuspenseQuery({
    queryKey: ["tracks", trackId],
    queryFn: () => TracksService.getTrack({ trackId }),
  })

  return (
    <div className="space-y-10">
      <TrackForm
        defaultValues={track}
        onSuccess={() => navigate({ to: "/events/tracks" })}
      />
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Events in this track
          </h2>
          <p className="text-sm text-muted-foreground">
            Events that have been assigned to this track.
          </p>
        </div>
        <TrackEventsList trackId={trackId} />
      </section>
    </div>
  )
}

function EditTrackPage() {
  const { trackId } = Route.useParams()

  return (
    <FormPageLayout
      title="Edit Track"
      description="Update track details and view associated events"
      backTo="/events/tracks"
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <EditTrackContent trackId={trackId} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
