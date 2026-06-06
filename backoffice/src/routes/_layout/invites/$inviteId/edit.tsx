import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"

import { type InvitePublic, InvitesService } from "@/client"
import { CopyLinkButton } from "@/components/Common/CopyLinkButton"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { InviteForm } from "@/components/forms/InviteForm"
import { Skeleton } from "@/components/ui/skeleton"
import { useCurrentTenant } from "@/hooks/useCurrentTenant"
import { useGoBack } from "@/hooks/useGoBack"
import { getInvitePortalUrl, getPortalBaseUrl } from "@/lib/portal-urls"

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

function InviteCopyLinkAction({ invite }: { invite: InvitePublic }) {
  const { data: tenant } = useCurrentTenant()
  const baseUrl = getPortalBaseUrl(tenant)
  const url =
    baseUrl && invite.token ? getInvitePortalUrl(baseUrl, invite.token) : null
  return <CopyLinkButton url={url} iconOnly={false} />
}

function EditInviteActions({ inviteId }: { inviteId: string }) {
  const { data: invite } = useSuspenseQuery(getInviteQueryOptions(inviteId))
  return <InviteCopyLinkAction invite={invite} />
}

function EditInvitePage() {
  const { inviteId } = Route.useParams()

  return (
    <FormPageLayout
      title="Edit Invite"
      description="Update invite settings and discount"
      backTo="/invites"
      actions={
        <Suspense fallback={null}>
          <EditInviteActions inviteId={inviteId} />
        </Suspense>
      }
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <EditInviteContent inviteId={inviteId} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
