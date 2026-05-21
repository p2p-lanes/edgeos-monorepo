import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"

import { EventSettingsService } from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { EventForm } from "@/components/forms/EventForm"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import { useGoBack } from "@/hooks/useGoBack"

interface NewEventSearch {
  venueId?: string
  startTime?: string
}

export const Route = createFileRoute("/_layout/events/new")({
  component: NewEventPage,
  head: () => ({
    meta: [{ title: "New Event - EdgeOS" }],
  }),
  validateSearch: (search: Record<string, unknown>): NewEventSearch => ({
    venueId: typeof search.venueId === "string" ? search.venueId : undefined,
    startTime:
      typeof search.startTime === "string" ? search.startTime : undefined,
  }),
})

function NewEventForm({
  popupId,
  venueId,
  startTime,
}: {
  popupId: string
  venueId: string | undefined
  startTime: string | undefined
}) {
  const goBack = useGoBack({ to: "/events" })

  // Resolve the popup's configured timezone before mounting the form, so the
  // form's `timezone` field and the wall-clock interpretation of the start
  // time are consistent from the very first render. Without this gate the
  // form initialized with a "UTC" fallback and silently shifted events when
  // the user typed before settings finished loading.
  const { data: settings, isLoading } = useQuery({
    queryKey: ["event-settings", popupId],
    queryFn: () => EventSettingsService.getEventSettings({ popupId }),
    staleTime: 5 * 60 * 1000,
  })

  if (isLoading) {
    return <Skeleton className="h-96 w-full" />
  }

  const popupTimezone = settings?.timezone || "UTC"

  return (
    <EventForm
      initialVenueId={venueId}
      initialStartIso={startTime}
      popupTimezone={popupTimezone}
      onSuccess={goBack}
    />
  )
}

function NewEventPage() {
  const { selectedPopupId } = useWorkspace()
  const { venueId, startTime } = Route.useSearch()

  return (
    <FormPageLayout
      title="Create Event"
      description="Add a new event to this pop-up"
      backTo="/events"
    >
      {selectedPopupId ? (
        <NewEventForm
          popupId={selectedPopupId}
          venueId={venueId}
          startTime={startTime}
        />
      ) : (
        <WorkspaceAlert resource="event" action="create" />
      )}
    </FormPageLayout>
  )
}
