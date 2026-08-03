import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"

import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { InviteForm } from "@/components/forms/InviteForm"
import useAuth from "@/hooks/useAuth"
import { useGoBack } from "@/hooks/useGoBack"

export const Route = createFileRoute("/_layout/invites/new")({
  component: NewInvite,
  head: () => ({
    meta: [{ title: "New Invite - EdgeOS" }],
  }),
})

function NewInvite() {
  const navigate = useNavigate()
  const goBack = useGoBack({ to: "/invites" })
  const { isOperatorOrAbove, isUserLoading } = useAuth()

  useEffect(() => {
    if (!isUserLoading && !isOperatorOrAbove) {
      navigate({ to: "/invites" })
    }
  }, [isOperatorOrAbove, isUserLoading, navigate])

  if (isUserLoading || !isOperatorOrAbove) {
    return null
  }

  return (
    <FormPageLayout
      title="Create Invite"
      description="Create an invite link with optional discount and approval behavior"
      backTo="/invites"
    >
      <InviteForm onSuccess={goBack} />
    </FormPageLayout>
  )
}
