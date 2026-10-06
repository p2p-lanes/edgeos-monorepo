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
  // ?tab=features opens straight on a tab, for links to one setting.
  validateSearch: (search: Record<string, unknown>): { tab?: string } =>
    typeof search.tab === "string" ? { tab: search.tab } : {},
  head: () => ({
    meta: [{ title: "Edit Gathering - EdgeOS" }],
  }),
})

function EditPopupContent({ popupId, tab }: { popupId: string; tab?: string }) {
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
    <PopupForm
      defaultValues={popup}
      defaultHome={home}
      onSuccess={goBack}
      initialTab={tab}
    />
  )
}

function EditPopupPage() {
  const { id } = Route.useParams()
  const { tab } = Route.useSearch()

  return (
    <FormPageLayout
      title="Edit Gathering"
      description="Update gathering settings and configuration"
      backTo="/popups"
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <EditPopupContent popupId={id} tab={tab} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
