import { createFileRoute, useNavigate } from "@tanstack/react-router"

import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { TenantForm } from "@/components/forms/TenantForm"

export const Route = createFileRoute("/_layout/organizations/new")({
  component: NewTenant,
  head: () => ({
    meta: [{ title: "New Organization - EdgeOS" }],
  }),
})

function NewTenant() {
  const navigate = useNavigate()

  return (
    <FormPageLayout
      title="Create Organization"
      description="Add a new organization to the platform"
      backTo="/organizations"
    >
      <TenantForm onSuccess={() => navigate({ to: "/organizations" })} />
    </FormPageLayout>
  )
}
