import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"

import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { GroupForm } from "@/components/forms/GroupForm"
import useAuth from "@/hooks/useAuth"
import { useGoBack } from "@/hooks/useGoBack"

export const Route = createFileRoute("/_layout/groups/new")({
  component: NewGroup,
  head: () => ({
    meta: [{ title: "New Group - EdgeOS" }],
  }),
})

function NewGroup() {
  const navigate = useNavigate()
  const goBack = useGoBack({ to: "/groups" })
  const { isOperatorOrAbove, isUserLoading } = useAuth()

  // Redirect viewers to groups list - they cannot create new groups
  useEffect(() => {
    if (!isUserLoading && !isOperatorOrAbove) {
      navigate({ to: "/groups" })
    }
  }, [isOperatorOrAbove, isUserLoading, navigate])

  if (isUserLoading || !isOperatorOrAbove) {
    return null
  }

  return (
    <FormPageLayout
      title="Create Group"
      description="Add a new registration group with optional discounts"
      backTo="/groups"
    >
      <GroupForm onSuccess={goBack} />
    </FormPageLayout>
  )
}
