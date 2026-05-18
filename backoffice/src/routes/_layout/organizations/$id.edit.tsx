import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"

import { TenantsService } from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { TenantForm } from "@/components/forms/TenantForm"
import { Skeleton } from "@/components/ui/skeleton"
import useAuth from "@/hooks/useAuth"
import { useGoBack } from "@/hooks/useGoBack"

export const Route = createFileRoute("/_layout/organizations/$id/edit")({
  component: EditTenantPage,
  head: () => ({
    meta: [{ title: "Edit Organization - EdgeOS" }],
  }),
})

function getTenantQueryOptions(tenantId: string) {
  return {
    queryKey: ["tenants", tenantId],
    queryFn: () => TenantsService.getTenant({ tenantId }),
  }
}

function EditTenantContent({ tenantId }: { tenantId: string }) {
  const { isSuperadmin } = useAuth()
  const goBack = useGoBack({ to: isSuperadmin ? "/organizations" : "/" })
  const { data: tenant } = useSuspenseQuery(getTenantQueryOptions(tenantId))

  return <TenantForm defaultValues={tenant} onSuccess={goBack} />
}

function EditTenantPage() {
  const { id } = Route.useParams()
  const { isSuperadmin } = useAuth()

  return (
    <FormPageLayout
      title="Edit Organization"
      description="Update organization settings and configuration"
      backTo={isSuperadmin ? "/organizations" : "/"}
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <EditTenantContent tenantId={id} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
