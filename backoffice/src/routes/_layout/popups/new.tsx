import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"

import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { PopupForm } from "@/components/forms/PopupForm"
import useAuth from "@/hooks/useAuth"

export const Route = createFileRoute("/_layout/popups/new")({
  component: NewPopup,
  head: () => ({
    meta: [{ title: "New Pop-up - EdgeOS" }],
  }),
})

function NewPopup() {
  const navigate = useNavigate()
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
      title="Create Pop-up"
      description="Add a new pop-up to manage"
      backTo="/popups"
    >
      <PopupForm onSuccess={() => navigate({ to: "/popups" })} />
    </FormPageLayout>
  )
}
