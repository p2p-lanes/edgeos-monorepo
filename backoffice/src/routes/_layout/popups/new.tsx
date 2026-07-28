import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"

import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { PopupForm } from "@/components/forms/PopupForm"
import useAuth from "@/hooks/useAuth"
import { useGoBack } from "@/hooks/useGoBack"

export const Route = createFileRoute("/_layout/popups/new")({
  component: NewPopup,
  head: () => ({
    meta: [{ title: "New Gathering - EdgeOS" }],
  }),
})

function NewPopup() {
  const navigate = useNavigate()
  const goBack = useGoBack({ to: "/popups" })
  const { isOperatorOrAbove, isUserLoading } = useAuth()

  // Redirect viewers to popups list - they cannot create new popups
  useEffect(() => {
    if (!isUserLoading && !isOperatorOrAbove) {
      navigate({ to: "/popups" })
    }
  }, [isOperatorOrAbove, isUserLoading, navigate])

  if (isUserLoading || !isOperatorOrAbove) {
    return null
  }

  return (
    <FormPageLayout
      title="Create Gathering"
      description="Add a new gathering to manage"
      backTo="/popups"
    >
      <PopupForm onSuccess={goBack} />
    </FormPageLayout>
  )
}
