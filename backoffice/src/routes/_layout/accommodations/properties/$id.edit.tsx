import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Suspense } from "react"

import { AccommodationsService } from "@/client"
import { PropertyForm } from "@/components/accommodations/PropertyForm"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { Skeleton } from "@/components/ui/skeleton"
import { useGoBack } from "@/hooks/useGoBack"

export const Route = createFileRoute(
  "/_layout/accommodations/properties/$id/edit",
)({
  component: EditPropertyPage,
  head: () => ({
    meta: [{ title: "Edit Property - EdgeOS" }],
  }),
})

/** Back lands on the Properties tab, not on the section's default calendar. */
function usePropertiesGoBack() {
  const navigate = useNavigate()
  return useGoBack(() =>
    navigate({ to: "/accommodations", search: { tab: "properties" } }),
  )
}

function EditPropertyContent({ propertyId }: { propertyId: string }) {
  const goBack = usePropertiesGoBack()
  const { data: property } = useSuspenseQuery({
    queryKey: ["accommodations", "property", propertyId],
    queryFn: () => AccommodationsService.getProperty({ propertyId }),
  })

  return (
    <PropertyForm
      popupId={property.popup_id}
      defaultValues={property}
      onSuccess={goBack}
    />
  )
}

function EditPropertyPage() {
  const { id } = Route.useParams()
  const goBack = usePropertiesGoBack()

  return (
    <FormPageLayout
      title="Edit property"
      description="Contact, lodging tax and visibility"
      backTo="/accommodations"
      onBack={goBack}
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <EditPropertyContent propertyId={id} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
