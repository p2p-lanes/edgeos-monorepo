import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Suspense } from "react"

import { HumansService } from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { HumanForm } from "@/components/forms/HumanForm"
import { Skeleton } from "@/components/ui/skeleton"
import { getHumansNavigationTarget } from "@/routes/_layout/humans/navigation"

export const Route = createFileRoute("/_layout/humans/$id/edit")({
  component: EditHumanPage,
  head: () => ({
    meta: [{ title: "Edit Human - EdgeOS" }],
  }),
})

function getHumanQueryOptions(humanId: string) {
  return {
    queryKey: ["humans", humanId],
    queryFn: () => HumansService.getHuman({ humanId }),
  }
}

function EditHumanContent({ humanId }: { humanId: string }) {
  const navigate = useNavigate()
  const { data: human } = useSuspenseQuery(getHumanQueryOptions(humanId))

  return (
    <HumanForm
      defaultValues={human}
      onSuccess={() => navigate(getHumansNavigationTarget())}
    />
  )
}

function EditHumanPage() {
  const navigate = useNavigate()
  const { id } = Route.useParams()

  return (
    <FormPageLayout
      title="Edit Human"
      description="Update human profile information"
      backTo="/humans"
      onBack={() => navigate(getHumansNavigationTarget())}
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <EditHumanContent humanId={id} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
