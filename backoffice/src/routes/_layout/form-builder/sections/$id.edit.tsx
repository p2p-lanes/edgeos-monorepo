import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Suspense } from "react"

import { FormSectionsService } from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { FormSectionForm } from "@/components/forms/FormSectionForm"
import { Skeleton } from "@/components/ui/skeleton"

export const Route = createFileRoute("/_layout/form-builder/sections/$id/edit")(
  {
    component: EditFormSectionPage,
    head: () => ({
      meta: [{ title: "Edit Section - EdgeOS" }],
    }),
  },
)

function getFormSectionQueryOptions(sectionId: string) {
  return {
    queryKey: ["form-sections", sectionId],
    queryFn: () => FormSectionsService.getFormSection({ sectionId }),
  }
}

function EditFormSectionContent({ sectionId }: { sectionId: string }) {
  const navigate = useNavigate()
  const { data: section } = useSuspenseQuery(
    getFormSectionQueryOptions(sectionId),
  )

  return (
    <FormSectionForm
      defaultValues={section}
      onSuccess={() => navigate({ to: "/form-builder" })}
    />
  )
}

function EditFormSectionPage() {
  const { id } = Route.useParams()

  return (
    <FormPageLayout
      title="Edit Section"
      description="Update section configuration"
      backTo="/form-builder"
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <EditFormSectionContent sectionId={id} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
