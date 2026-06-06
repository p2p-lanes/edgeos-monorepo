import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"

import { GroupsService } from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { GroupForm } from "@/components/forms/GroupForm"
import { GroupMembersSection } from "@/components/groups/GroupMembersSection"
import { Skeleton } from "@/components/ui/skeleton"
import { useGoBack } from "@/hooks/useGoBack"

export const Route = createFileRoute("/_layout/groups/$id/edit")({
  component: EditGroupPage,
  head: () => ({
    meta: [{ title: "Edit Group - EdgeOS" }],
  }),
})

function getGroupQueryOptions(groupId: string) {
  return {
    queryKey: ["groups", groupId],
    queryFn: () => GroupsService.getGroup({ groupId }),
  }
}

function EditGroupContent({ groupId }: { groupId: string }) {
  const goBack = useGoBack({ to: "/groups" })
  const { data: group } = useSuspenseQuery(getGroupQueryOptions(groupId))

  return (
    <>
      <GroupForm defaultValues={group} onSuccess={goBack} />
      <GroupMembersSection group={group} />
    </>
  )
}

function EditGroupPage() {
  const { id } = Route.useParams()

  return (
    <FormPageLayout
      title="Edit Group"
      description="Update group settings and discounts"
      backTo="/groups"
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <EditGroupContent groupId={id} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
