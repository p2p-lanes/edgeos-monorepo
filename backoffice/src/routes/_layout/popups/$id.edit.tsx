import { useSuspenseQueries } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"

import { PopupsService } from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { PopupForm } from "@/components/forms/PopupForm"
import { Skeleton } from "@/components/ui/skeleton"
import { useGoBack } from "@/hooks/useGoBack"

export const Route = createFileRoute("/_layout/popups/$id/edit")({
  component: EditPopupPage,
  head: () => ({
    meta: [{ title: "Edit Gathering - EdgeOS" }],
  }),
})

function EditPopupContent({ popupId }: { popupId: string }) {
  const goBack = useGoBack({ to: "/popups" })
  const [{ data: popup }, { data: home }] = useSuspenseQueries({
    queries: [
      {
        queryKey: ["popups", popupId],
        queryFn: () => PopupsService.getPopup({ popupId }),
      },
      {
        queryKey: ["popup-home", popupId],
        queryFn: () => PopupsService.getPopupHome({ popupId }),
      },
    ],
  })

  return (
    <PopupForm defaultValues={popup} defaultHome={home} onSuccess={goBack} />
  )
}

function EditPopupPage() {
  const { id } = Route.useParams()

  return (
    <FormPageLayout
      title="Edit Gathering"
      description="Update gathering settings and configuration"
      backTo="/popups"
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <EditPopupContent popupId={id} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
