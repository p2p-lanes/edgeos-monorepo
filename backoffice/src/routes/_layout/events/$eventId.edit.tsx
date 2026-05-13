import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { CalendarClock } from "lucide-react"
import { Suspense } from "react"

import { type EventPublic, EventsService, HumansService } from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { EventForm } from "@/components/forms/EventForm"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import useAuth from "@/hooks/useAuth"

function getInitials(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string,
): string {
  const first = firstName?.trim()?.[0] ?? ""
  const last = lastName?.trim()?.[0] ?? ""
  const initials = `${first}${last}`.toUpperCase()
  if (initials) return initials
  return email.slice(0, 2).toUpperCase()
}

function formatCreatedAt(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  try {
    const d = new Date(dateStr)
    if (Number.isNaN(d.getTime())) return null
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(d)
  } catch {
    return null
  }
}

function CreatedByCard({ event }: { event: EventPublic }) {
  const { isAdmin } = useAuth()
  const { data: owner } = useQuery({
    queryKey: ["humans", event.owner_id],
    queryFn: () => HumansService.getHuman({ humanId: event.owner_id }),
    enabled: isAdmin && !!event.owner_id,
    staleTime: 60_000,
  })

  const createdAt = formatCreatedAt(event.created_at)
  const displayName =
    owner && (owner.first_name || owner.last_name)
      ? [owner.first_name, owner.last_name].filter(Boolean).join(" ")
      : owner?.email || "Unknown"

  return (
    <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="size-10 border bg-background">
          {owner?.picture_url && (
            <AvatarImage src={owner.picture_url} alt={displayName} />
          )}
          <AvatarFallback className="text-xs font-medium">
            {owner
              ? getInitials(owner.first_name, owner.last_name, owner.email)
              : "?"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Created by
          </p>
          <p className="truncate text-sm font-medium leading-tight">
            {displayName}
          </p>
          {owner?.email && owner.email !== displayName && (
            <p className="truncate text-xs text-muted-foreground">
              {owner.email}
            </p>
          )}
        </div>
      </div>
      {createdAt && (
        <div className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <CalendarClock className="h-3.5 w-3.5" />
          <span>{createdAt}</span>
        </div>
      )}
    </div>
  )
}

export const Route = createFileRoute("/_layout/events/$eventId/edit")({
  component: EditEventPage,
  head: () => ({
    meta: [{ title: "Edit Event - EdgeOS" }],
  }),
})

function EditEventContent({ eventId }: { eventId: string }) {
  const navigate = useNavigate()
  const { data: event } = useSuspenseQuery({
    queryKey: ["events", eventId],
    queryFn: () => EventsService.getEvent({ eventId }),
  })

  return (
    <div className="space-y-4">
      <CreatedByCard event={event} />
      <EventForm
        defaultValues={event}
        onSuccess={() => navigate({ to: "/events" })}
      />
    </div>
  )
}

function EditEventPage() {
  const { eventId } = Route.useParams()

  return (
    <FormPageLayout
      title="Edit Event"
      description="Update event details"
      backTo="/events"
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <EditEventContent eventId={eventId} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
