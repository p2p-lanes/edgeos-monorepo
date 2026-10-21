import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"
import { ApplicationsService } from "@/client"
import { ApplicationDetail } from "@/components/ApplicationDetail"
import { ApplicationStatusStepper } from "@/components/applications/ApplicationStatusStepper"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { Skeleton } from "@/components/ui/skeleton"

export const Route = createFileRoute("/_layout/applications/$id")({
  component: ViewApplicationPage,
  head: () => ({
    meta: [{ title: "Application Details - EdgeOS" }],
  }),
})

function getApplicationQueryOptions(applicationId: string) {
  return {
    queryKey: ["applications", applicationId],
    queryFn: () => ApplicationsService.getApplication({ applicationId }),
  }
}

function ViewApplicationContent({ applicationId }: { applicationId: string }) {
  const queryClient = useQueryClient()
  const { data: application, refetch } = useSuspenseQuery(
    getApplicationQueryOptions(applicationId),
  )

  const handleReviewSuccess = () => {
    refetch()
    queryClient.invalidateQueries({ queryKey: ["applications"] })
    queryClient.invalidateQueries({
      queryKey: ["pending-reviews"],
    })
    queryClient.invalidateQueries({
      queryKey: ["pending-reviews-count"],
    })
    queryClient.invalidateQueries({
      queryKey: ["dashboard", "stats"],
    })
  }

  return (
    <ApplicationDetail
      application={application}
      onReviewSuccess={handleReviewSuccess}
      headerExtra={
        <>
          {/* Metadata */}
          <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
            {application.submitted_at && (
              <div>
                <span className="text-xs uppercase tracking-wider">
                  Submitted
                </span>
                <p>{new Date(application.submitted_at).toLocaleDateString()}</p>
              </div>
            )}
            {application.accepted_at && (
              <div>
                <span className="text-xs uppercase tracking-wider">
                  {application.status === "withdrawn"
                    ? "Previously accepted"
                    : "Accepted"}
                </span>
                <p>{new Date(application.accepted_at).toLocaleDateString()}</p>
              </div>
            )}
            {application.referred_by_name && (
              <div>
                <span className="text-xs uppercase tracking-wider">
                  Referred by
                </span>
                <p>{application.referred_by_name}</p>
              </div>
            )}
          </div>

          {/* Stepper */}
          {application.status !== "draft" && (
            <ApplicationStatusStepper application={application} />
          )}
        </>
      }
    />
  )
}

function ViewApplicationPage() {
  const { id } = Route.useParams()

  return (
    <FormPageLayout
      title="Application Details"
      description="View application information and submit reviews"
      backTo="/applications"
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <ViewApplicationContent applicationId={id} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
