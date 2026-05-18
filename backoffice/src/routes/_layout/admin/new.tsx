import { createFileRoute } from "@tanstack/react-router"

import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { UserForm } from "@/components/forms/UserForm"
import { useGoBack } from "@/hooks/useGoBack"

export const Route = createFileRoute("/_layout/admin/new")({
  component: NewUser,
  head: () => ({
    meta: [{ title: "New User - EdgeOS" }],
  }),
})

function NewUser() {
  const goBack = useGoBack({ to: "/admin" })

  return (
    <FormPageLayout
      title="Add User"
      description="Create a new user account"
      backTo="/admin"
    >
      <UserForm onSuccess={goBack} />
    </FormPageLayout>
  )
}
