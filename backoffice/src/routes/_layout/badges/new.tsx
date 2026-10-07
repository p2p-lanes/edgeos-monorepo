import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"

import { BadgeForm } from "@/components/Badges/BadgeForm"
import { BadgesOffNotice } from "@/components/Badges/BadgesOffNotice"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import useAuth from "@/hooks/useAuth"
import { useGoBack } from "@/hooks/useGoBack"

export const Route = createFileRoute("/_layout/badges/new")({
  component: NewBadge,
  head: () => ({
    meta: [{ title: "New Badge - EdgeOS" }],
  }),
})

function NewBadge() {
  const navigate = useNavigate()
  const goBack = useGoBack({ to: "/badges" })
  const { isOperatorOrAbove, isUserLoading } = useAuth()

  useEffect(() => {
    if (!isUserLoading && !isOperatorOrAbove) {
      navigate({ to: "/badges" })
    }
  }, [isOperatorOrAbove, isUserLoading, navigate])

  if (isUserLoading || !isOperatorOrAbove) {
    return null
  }

  return (
    <FormPageLayout
      title="Create Badge"
      description="Add a badge to your collection"
      backTo="/badges"
    >
      <div className="space-y-6">
        <BadgesOffNotice className="mx-auto max-w-2xl" />
        <BadgeForm onSuccess={goBack} />
      </div>
    </FormPageLayout>
  )
}
