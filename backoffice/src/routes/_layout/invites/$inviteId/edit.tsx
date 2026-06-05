import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"

import { InvitesService } from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { InviteForm } from "@/components/forms/InviteForm"
import { Skeleton } from "@/components/ui/skeleton"
import { useGoBack } from "@/hooks/useGoBack"

export const Route = createFileRoute("/_layout/invites/$inviteId/edit")({
  component: EditInvitePage,
  head: () => ({
    meta: [{ title: "Edit Invite - EdgeOS" }],
  }),
})

function getInviteQueryOptions(inviteId: string) {
  return {
    queryKey: ["invites", inviteId],
    queryFn: () => InvitesService.getInvite({ inviteId }),
  }
}

function EditInviteContent({ inviteId }: { inviteId: string }) {
  const goBack = useGoBack({ to: "/invites" })
  const { data: invite } = useSuspenseQuery(getInviteQueryOptions(inviteId))

  return <InviteForm defaultValues={invite} onSuccess={goBack} />
}

function EditInvitePage() {
  const { inviteId } = Route.useParams()

  return (
    <FormPageLayout
      title="Edit Invite"
      description="Update invite settings and discount"
      backTo="/invites"
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <EditInviteContent inviteId={inviteId} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
