import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Pencil, User } from "lucide-react"
import { Suspense, useState } from "react"

import { HumansService } from "@/client"
import { DangerZone } from "@/components/Common/DangerZone"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { DeclaredFieldsCard } from "@/components/Humans/DeclaredFieldsCard"
import { EnrichedProfileCard } from "@/components/Humans/EnrichedProfileCard"
import { HumanActivity } from "@/components/Humans/HumanActivity"
import { HumanApiKeysCard } from "@/components/Humans/HumanApiKeysCard"
import { HumanCommentThread } from "@/components/Humans/HumanCommentThread"
import { HumanProfileEditForm } from "@/components/Humans/HumanProfileEditForm"
import { HumanRatingControl } from "@/components/Humans/HumanRatingControl"
import { ratingMeta } from "@/components/Humans/humanFields"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { useGoBack } from "@/hooks/useGoBack"
import { getHumansNavigationTarget } from "@/routes/_layout/humans/navigation"
import { createErrorHandler } from "@/utils"

export const Route = createFileRoute("/_layout/humans/$id")({
  component: EditHumanPage,
  head: () => ({
    meta: [{ title: "Human - EdgeOS" }],
  }),
})

function getHumanQueryOptions(humanId: string) {
  return {
    queryKey: ["humans", humanId],
    queryFn: () => HumansService.getHuman({ humanId }),
  }
}

function EditHumanContent({ humanId }: { humanId: string }) {
  const navigate = useNavigate()
  const { data: human } = useSuspenseQuery(getHumanQueryOptions(humanId))
  const { isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [editOpen, setEditOpen] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => HumansService.deleteHuman({ humanId }),
    onSuccess: () => {
      showSuccessToast("Human deleted")
      // Drop cached detail + api-keys subqueries first so the list invalidation
      // below doesn't refetch the now-deleted human and 404.
      queryClient.removeQueries({ queryKey: ["humans", humanId] })
      queryClient.invalidateQueries({ queryKey: ["humans"] })
      navigate(getHumansNavigationTarget())
    },
    onError: createErrorHandler(showErrorToast),
  })

  const displayName =
    [human.first_name, human.last_name].filter(Boolean).join(" ") ||
    human.email ||
    humanId
  const rating = ratingMeta(human.rating)

  return (
    <Tabs defaultValue="details" className="space-y-6">
      <TabsList>
        <TabsTrigger value="details">Detalles</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>

      <TabsContent value="details">
        <div className="space-y-6">
          {/* Identity — the single source of who this person is. */}
          <Card>
            <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
              <div className="flex min-w-0 items-center gap-4">
                {human.picture_url ? (
                  <img
                    src={human.picture_url}
                    alt=""
                    width={48}
                    height={48}
                    className="h-12 w-12 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                    <User className="h-6 w-6 text-primary" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-xl font-semibold">
                      {displayName}
                    </h2>
                    <Badge variant={rating.badge}>{rating.label}</Badge>
                  </div>
                  <p className="truncate text-sm text-muted-foreground">
                    {human.email}
                  </p>
                </div>
              </div>
              {isAdmin && (
                <div className="sm:ml-auto">
                  <Button variant="outline" onClick={() => setEditOpen(true)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit profile
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              {/* Assessment — the rating decision and the notes that justify it,
                  together in one place. */}
              <Card>
                <CardHeader>
                  <CardTitle>Assessment</CardTitle>
                  <CardDescription>
                    Admin rating for gathering admission. Only Red Flag blocks
                    the user (revokes API keys and rejects in-review
                    applications).
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <HumanRatingControl human={human} />
                  <Separator />
                  <HumanCommentThread humanId={humanId} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Applications</CardTitle>
                  <CardDescription>
                    Every application this person submitted.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <DeclaredFieldsCard human={human} />
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Rich profile</CardTitle>
                  <CardDescription>
                    Curated from non-declared signals (Telegram activity,
                    events).
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <EnrichedProfileCard human={human} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <HumanApiKeysCard human={human} />
                </CardContent>
              </Card>
            </div>
          </div>

          {isAdmin && (
            <div className="mx-auto max-w-2xl pt-6">
              <DangerZone
                description="Permanently delete this human and every related row — applications, attendees, payments, products, carts, group memberships, and any group this human owns as ambassador. Intended for cleaning up test users."
                onDelete={() => deleteMutation.mutate()}
                isDeleting={deleteMutation.isPending}
                confirmText="Delete Human"
                resourceName={displayName}
                variant="inline"
              />
            </div>
          )}
        </div>
      </TabsContent>

      <TabsContent value="activity">
        <div className="mx-auto max-w-2xl">
          <HumanActivity humanId={humanId} />
        </div>
      </TabsContent>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit profile</DialogTitle>
            <DialogDescription>
              Update this person's profile information.
            </DialogDescription>
          </DialogHeader>
          <HumanProfileEditForm
            human={human}
            onSuccess={() => setEditOpen(false)}
            onCancel={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </Tabs>
  )
}

function EditHumanPage() {
  const navigate = useNavigate()
  const goBack = useGoBack(() => navigate(getHumansNavigationTarget()))
  const { id } = Route.useParams()
  const { data: human } = useQuery(getHumanQueryOptions(id))
  const title = human
    ? [human.first_name, human.last_name].filter(Boolean).join(" ") ||
      human.email ||
      "Human"
    : "Human"

  return (
    <FormPageLayout
      title={title}
      description="Human profile"
      backTo="/humans"
      onBack={goBack}
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <EditHumanContent humanId={id} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
