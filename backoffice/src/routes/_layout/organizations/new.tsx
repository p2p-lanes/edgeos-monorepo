import { createFileRoute } from "@tanstack/react-router"

import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { TenantForm } from "@/components/forms/TenantForm"
import { useGoBack } from "@/hooks/useGoBack"

export const Route = createFileRoute("/_layout/organizations/new")({
  component: NewTenant,
  head: () => ({
    meta: [{ title: "New Organization - EdgeOS" }],
  }),
})

function NewTenant() {
  const goBack = useGoBack({ to: "/organizations" })

  return (
    <FormPageLayout
      title="Create Organization"
      description="Add a new organization to the platform"
      backTo="/organizations"
    >
      <TenantForm onSuccess={goBack} />
    </FormPageLayout>
  )
}
