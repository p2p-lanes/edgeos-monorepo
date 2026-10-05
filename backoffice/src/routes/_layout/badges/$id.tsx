import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { ArchiveRestore } from "lucide-react"
import { Suspense } from "react"

import { BadgesService } from "@/client"
import { BadgeAwardsList } from "@/components/Badges/BadgeAwardsList"
import { BadgeForm } from "@/components/Badges/BadgeForm"
import { BadgeRulesCard } from "@/components/Badges/BadgeRules"
import { IssuerPoliciesCard } from "@/components/Badges/IssuerPolicies"
import { DangerZone } from "@/components/Common/DangerZone"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { useGoBack } from "@/hooks/useGoBack"
import { createErrorHandler } from "@/utils"

export const Route = createFileRoute("/_layout/badges/$id")({
  component: BadgeDetailPage,
  head: () => ({
    meta: [{ title: "Badge - EdgeOS" }],
  }),
})

function getBadgeQueryOptions(badgeId: string) {
  return {
    queryKey: ["badges", badgeId],
    queryFn: () => BadgesService.getBadge({ badgeId }),
  }
}

function Recipients({ badgeId }: { badgeId: string }) {
  const { data } = useQuery({
    queryKey: ["badge-awards", { badgeId }],
    queryFn: () => BadgesService.listBadgeAwards({ badgeId, limit: 200 }),
  })
  const awards = data?.results ?? []

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Recipients</CardTitle>
        <CardDescription>
          Give this badge from a person's page in Humans.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {awards.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody has this badge yet.
          </p>
        ) : (
          <BadgeAwardsList awards={awards} show="recipient" />
        )}
      </CardContent>
    </Card>
  )
}

function BadgeDetailContent({ badgeId }: { badgeId: string }) {
  const navigate = useNavigate()
  const goBack = useGoBack({ to: "/badges" })
  const queryClient = useQueryClient()
  const { isOperatorOrAbove } = useAuth()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { data: badge } = useSuspenseQuery(getBadgeQueryOptions(badgeId))
  const awarded = (badge.award_count ?? 0) > 0 || !!badge.archived_at

  const remove = useMutation({
    mutationFn: () => BadgesService.deleteBadge({ badgeId }),
    onSuccess: () => {
      showSuccessToast(awarded ? "Badge archived" : "Badge deleted")
      queryClient.invalidateQueries({ queryKey: ["badges"] })
      navigate({ to: "/badges" })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const restore = useMutation({
    mutationFn: () =>
      BadgesService.updateBadge({ badgeId, requestBody: { archived: false } }),
    onSuccess: () => {
      showSuccessToast("Badge restored")
      queryClient.invalidateQueries({ queryKey: ["badges"] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  return (
    <div className="space-y-6">
      {badge.archived_at && (
        <Alert className="mx-auto max-w-2xl">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            Archived: people keep it, but it can't be given anymore.
            {isOperatorOrAbove && (
              <LoadingButton
                size="sm"
                variant="outline"
                loading={restore.isPending}
                onClick={() => restore.mutate()}
              >
                <ArchiveRestore className="h-4 w-4" />
                Restore
              </LoadingButton>
            )}
          </AlertDescription>
        </Alert>
      )}

      <BadgeForm
        key={badge.updated_at}
        defaultValues={badge}
        onSuccess={goBack}
      />

      <IssuerPoliciesCard badgeId={badgeId} />

      <BadgeRulesCard badgeId={badgeId} />

      <Recipients badgeId={badgeId} />

      {isOperatorOrAbove && !badge.archived_at && (
        <div className="mx-auto max-w-2xl">
          <DangerZone
            title={awarded ? "Archive badge" : undefined}
            description={
              awarded
                ? "This badge was already given, so it is archived instead of deleted: everyone keeps it, but nobody can receive it anymore."
                : "This badge was never given. Deleting it removes it and its artwork for good."
            }
            onDelete={() => remove.mutate()}
            isDeleting={remove.isPending}
            confirmText={awarded ? "Archive Badge" : "Delete Badge"}
            resourceName={badge.name}
            variant="inline"
          />
        </div>
      )}
    </div>
  )
}

function BadgeDetailPage() {
  const { id } = Route.useParams()

  return (
    <FormPageLayout
      title="Badge"
      description="Artwork, settings and who has it"
      backTo="/badges"
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <BadgeDetailContent badgeId={id} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
