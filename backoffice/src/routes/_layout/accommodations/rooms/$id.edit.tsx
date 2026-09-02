import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"

import { AccommodationsService } from "@/client"
import { AccommodationForm } from "@/components/accommodations/AccommodationForm"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { Skeleton } from "@/components/ui/skeleton"
import { useGoBack } from "@/hooks/useGoBack"

export const Route = createFileRoute("/_layout/accommodations/rooms/$id/edit")({
  component: EditRoomPage,
  head: () => ({
    meta: [{ title: "Edit Room - EdgeOS" }],
  }),
})

function EditRoomContent({ accommodationId }: { accommodationId: string }) {
  const goBack = useGoBack({ to: "/accommodations" })
  const { data: room } = useSuspenseQuery({
    queryKey: ["accommodations", "room", accommodationId],
    queryFn: () => AccommodationsService.getAccommodation({ accommodationId }),
  })

  return (
    <AccommodationForm
      popupId={room.popup_id}
      defaultValues={room}
      onSuccess={goBack}
    />
  )
}

function EditRoomPage() {
  const { id } = Route.useParams()

  return (
    <FormPageLayout
      title="Edit room type"
      description="Beds, pricing, units and photos"
      backTo="/accommodations"
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <EditRoomContent accommodationId={id} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
