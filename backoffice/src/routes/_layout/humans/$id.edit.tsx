import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Suspense } from "react"

import { HumansService } from "@/client"
import { DangerZone } from "@/components/Common/DangerZone"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { HumanForm } from "@/components/forms/HumanForm"
import { Skeleton } from "@/components/ui/skeleton"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { useGoBack } from "@/hooks/useGoBack"
import { getHumansNavigationTarget } from "@/routes/_layout/humans/navigation"
import { createErrorHandler } from "@/utils"

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
  const goBack = useGoBack(() => navigate(getHumansNavigationTarget()))
  const { data: human } = useSuspenseQuery(getHumanQueryOptions(humanId))
  const { isSuperadmin } = useAuth()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const deleteMutation = useMutation({
    mutationFn: () => HumansService.deleteHuman({ humanId }),
    onSuccess: () => {
      showSuccessToast("Human deleted")
      queryClient.invalidateQueries({ queryKey: ["humans"] })
      navigate(getHumansNavigationTarget())
    },
    onError: createErrorHandler(showErrorToast),
  })

  const displayName =
    [human.first_name, human.last_name].filter(Boolean).join(" ") ||
    human.email ||
    humanId

  return (
    <div className="space-y-8">
      <HumanForm defaultValues={human} onSuccess={goBack} />
      {isSuperadmin && (
        <div className="mx-auto max-w-2xl">
          <DangerZone
            description="Permanently delete this human and every related row — applications, attendees, payments, products, carts, group memberships, and any group this human owns as ambassador. Intended for cleaning up test users."
            onDelete={() => deleteMutation.mutate()}
            isDeleting={deleteMutation.isPending}
            confirmText="Delete Human"
            resourceName={displayName}
            variant="inline"
          />
        </div>
      )}
    </div>
  )
}

function EditHumanPage() {
  const navigate = useNavigate()
  const goBack = useGoBack(() => navigate(getHumansNavigationTarget()))
  const { id } = Route.useParams()

  return (
    <FormPageLayout
      title="Edit Human"
      description="Update human profile information"
      backTo="/humans"
      onBack={goBack}
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <EditHumanContent humanId={id} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
