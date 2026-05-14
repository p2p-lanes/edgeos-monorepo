import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"

import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { FormSectionForm } from "@/components/forms/FormSectionForm"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"

export const Route = createFileRoute("/_layout/form-builder/sections/new")({
  component: NewFormSection,
  head: () => ({
    meta: [{ title: "New Section - EdgeOS" }],
  }),
})

function NewFormSection() {
  const navigate = useNavigate()
  const { isOperatorOrAbove, isUserLoading } = useAuth()
  const { isContextReady } = useWorkspace()

  useEffect(() => {
    if (!isUserLoading && !isOperatorOrAbove) {
      navigate({ to: "/form-builder" })
    }
  }, [isOperatorOrAbove, isUserLoading, navigate])

  if (isUserLoading || !isOperatorOrAbove) {
    return null
  }

  if (!isContextReady) {
    return (
      <FormPageLayout
        title="Create Section"
        description="Add a section to group form fields"
        backTo="/form-builder"
      >
        <WorkspaceAlert resource="section" action="create" />
      </FormPageLayout>
    )
  }

  return (
    <FormPageLayout
      title="Create Section"
      description="Add a section to group form fields"
      backTo="/form-builder"
    >
      <FormSectionForm onSuccess={() => navigate({ to: "/form-builder" })} />
    </FormPageLayout>
  )
}
