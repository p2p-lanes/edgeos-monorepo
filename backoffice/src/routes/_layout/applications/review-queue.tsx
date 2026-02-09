import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import {
  ArrowLeft,
  ArrowRight,
  Building,
  Calendar,
  ChevronDown,
  ChevronUp,
  Inbox,
  Mail,
  MapPin,
  MessageCircle,
  ThumbsDown,
  ThumbsUp,
  User,
  Users,
} from "lucide-react"
import { useState } from "react"

import {
  type ApiError,
  type ApplicationPublic,
  ApplicationReviewsService,
  ApprovalStrategiesService,
  FormFieldsService,
  type ReviewDecision,
  type ReviewSummary,
} from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { StatusBadge } from "@/components/Common/StatusBadge"
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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LoadingButton } from "@/components/ui/loading-button"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

export const Route = createFileRoute("/_layout/applications/review-queue")({
  component: ReviewQueuePage,
  head: () => ({
    meta: [{ title: "Review Queue - EdgeOS" }],
  }),
})

interface FormFieldSchema {
  type: string
  label: string
  required: boolean
  section: string
  position?: number
  options?: string[]
}

interface ApplicationSchema {
  base_fields: Record<string, FormFieldSchema>
  custom_fields: Record<string, FormFieldSchema>
  sections: string[]
}

function ReviewQueuePage() {
  const { isContextReady, selectedPopupId } = useWorkspace()
  const { isAdmin } = useAuth()
  const [currentIndex, setCurrentIndex] = useState(0)

  const { data: pendingData, isLoading } = useQuery({
    queryKey: ["pending-reviews", selectedPopupId],
    queryFn: () =>
      ApplicationReviewsService.listPendingReviews({
        popupId: selectedPopupId || undefined,
        skip: 0,
        limit: 100,
      }),
    enabled: isContextReady && isAdmin,
  })

  const applications = (pendingData?.results ??
    []) as unknown as ApplicationPublic[]
  const total = applications.length
  const current = applications[currentIndex]

  if (!isContextReady || !isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Review Queue</h1>
          <p className="text-muted-foreground">
            Select a popup and sign in as admin to review applications
          </p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Review Queue</h1>
          <p className="text-muted-foreground">
            Loading pending applications...
          </p>
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (total === 0) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Review Queue</h1>
            <p className="text-muted-foreground">
              Review applications one by one
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/applications">Back to Applications</Link>
          </Button>
        </div>
        <EmptyState
          icon={Inbox}
          title="All caught up!"
          description="There are no applications pending your review."
          action={
            <Button variant="outline" asChild>
              <Link to="/applications">View All Applications</Link>
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Review Queue</h1>
          <p className="text-muted-foreground">
            Application {currentIndex + 1} of {total} pending review
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/applications">Back to List</Link>
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border bg-muted/50 px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
          disabled={currentIndex === 0}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Previous
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {currentIndex + 1} / {total}
          </span>
          <div className="h-1.5 w-32 rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-primary transition-all"
              style={{ width: `${((currentIndex + 1) / total) * 100}%` }}
            />
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCurrentIndex((i) => Math.min(total - 1, i + 1))}
          disabled={currentIndex >= total - 1}
        >
          Next
          <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </div>

      <ReviewQueueItem
        application={current}
        onReviewed={() =>
          setCurrentIndex((i) => Math.min(i, total - 2 < 0 ? 0 : total - 2))
        }
      />
    </div>
  )
}

function ReviewQueueItem({
  application,
  onReviewed,
}: {
  application: ApplicationPublic
  onReviewed: () => void
}) {
  const queryClient = useQueryClient()

  const { data: schema } = useQuery({
    queryKey: ["form-fields-schema", application.popup_id],
    queryFn: async () => {
      const result = await FormFieldsService.getApplicationSchema({
        popupId: application.popup_id,
      })
      return result as unknown as ApplicationSchema
    },
  })

  const { data: approvalStrategy } = useQuery({
    queryKey: ["approval-strategy", application.popup_id],
    queryFn: () =>
      ApprovalStrategiesService.getApprovalStrategy({
        popupId: application.popup_id,
      }),
    retry: false,
  })

  const { data: reviewSummary, refetch: refetchReviews } = useQuery({
    queryKey: ["review-summary", application.id],
    queryFn: () =>
      ApplicationReviewsService.getReviewSummary({
        applicationId: application.id,
      }),
  })

  const isWeightedVoting = approvalStrategy?.strategy_type === "weighted"

  const getFieldLabel = (fieldName: string): string => {
    if (schema?.custom_fields?.[fieldName]?.label) {
      return schema.custom_fields[fieldName].label
    }
    return fieldName
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  }

  const formatFieldValue = (value: unknown): string => {
    if (value === null || value === undefined) return "—"
    if (typeof value === "boolean") return value ? "Yes" : "No"
    if (Array.isArray(value)) return value.join(", ")
    return String(value)
  }

  // Group custom fields by section
  const getCustomFieldsBySection = () => {
    if (
      !application.custom_fields ||
      Object.keys(application.custom_fields).length === 0
    ) {
      return {
        unsectioned: [] as [string, unknown][],
        sectioned: {} as Record<string, [string, unknown][]>,
      }
    }
    const entries = Object.entries(application.custom_fields)
    const sorted = schema?.custom_fields
      ? entries.sort(([a], [b]) => {
          const posA = schema.custom_fields[a]?.position ?? 0
          const posB = schema.custom_fields[b]?.position ?? 0
          return posA - posB
        })
      : entries
    const unsectioned: [string, unknown][] = []
    const sectioned: Record<string, [string, unknown][]> = {}
    for (const [key, value] of sorted) {
      const section = schema?.custom_fields?.[key]?.section
      if (section) {
        if (!sectioned[section]) sectioned[section] = []
        sectioned[section].push([key, value])
      } else {
        unsectioned.push([key, value])
      }
    }
    return { unsectioned, sectioned }
  }
  const {
    unsectioned: unsectionedCustomFields,
    sectioned: sectionedCustomFields,
  } = getCustomFieldsBySection()

  const handleReviewSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["pending-reviews"] })
    queryClient.invalidateQueries({ queryKey: ["applications"] })
    refetchReviews()
    onReviewed()
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <User className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <CardTitle>
                    {application.human?.first_name}{" "}
                    {application.human?.last_name}
                  </CardTitle>
                  <CardDescription className="flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    {application.human?.email}
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {application.red_flag && (
                  <Badge variant="destructive">Flagged</Badge>
                )}
                <StatusBadge status={application.status} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {application.human?.organization && (
                <div className="flex items-start gap-2">
                  <Building className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Organization
                    </p>
                    <p className="font-medium">
                      {application.human.organization}
                    </p>
                  </div>
                </div>
              )}
              {application.human?.role && (
                <div className="flex items-start gap-2">
                  <User className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">Role</p>
                    <p className="font-medium">{application.human.role}</p>
                  </div>
                </div>
              )}
              {application.human?.residence && (
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">Residence</p>
                    <p className="font-medium">{application.human.residence}</p>
                  </div>
                </div>
              )}
              {application.human?.telegram && (
                <div className="flex items-start gap-2">
                  <MessageCircle className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">Telegram</p>
                    <p className="font-medium">{application.human.telegram}</p>
                  </div>
                </div>
              )}
              {application.human?.gender && (
                <div>
                  <p className="text-sm text-muted-foreground">Gender</p>
                  <p className="font-medium capitalize">
                    {application.human.gender}
                  </p>
                </div>
              )}
              {application.human?.age && (
                <div>
                  <p className="text-sm text-muted-foreground">Age Range</p>
                  <p className="font-medium">{application.human.age}</p>
                </div>
              )}
              {application.referral && (
                <div className="sm:col-span-2">
                  <p className="text-sm text-muted-foreground">Referral</p>
                  <p className="font-medium">{application.referral}</p>
                </div>
              )}
              {unsectionedCustomFields.length > 0 &&
                unsectionedCustomFields.map(([key, value]) => (
                  <div key={key}>
                    <p className="text-sm text-muted-foreground">
                      {getFieldLabel(key)}
                    </p>
                    <p className="font-medium">{formatFieldValue(value)}</p>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>

        {Object.entries(sectionedCustomFields).map(([section, fields]) => (
          <Card key={section}>
            <CardHeader>
              <CardTitle className="text-base capitalize">{section}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                {fields.map(([key, value]) => (
                  <div key={key}>
                    <p className="text-sm text-muted-foreground">
                      {getFieldLabel(key)}
                    </p>
                    <p className="font-medium">{formatFieldValue(value)}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}

        {application.attendees && application.attendees.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Attendees ({application.attendees.length})
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {application.attendees.map((attendee) => (
                  <div
                    key={attendee.id}
                    className="flex items-center justify-between rounded-lg border p-4"
                  >
                    <div>
                      <p className="font-medium">{attendee.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {attendee.email} • {attendee.category}
                      </p>
                    </div>
                    <code className="rounded bg-muted px-2 py-1 text-xs">
                      {attendee.check_in_code}
                    </code>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-6">
        {isWeightedVoting ? (
          <WeightedVotingCard
            application={application}
            onSuccess={handleReviewSuccess}
          />
        ) : (
          <SimpleReviewCard
            application={application}
            onSuccess={handleReviewSuccess}
          />
        )}

        {reviewSummary && <ReviewSummaryCard summary={reviewSummary} />}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {application.submitted_at && (
              <div className="flex items-start gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">Submitted</p>
                  <p className="text-sm font-medium">
                    {new Date(application.submitted_at).toLocaleString()}
                  </p>
                </div>
              </div>
            )}
            <Separator />
            <Button variant="outline" className="w-full" asChild>
              <Link to="/applications/$id" params={{ id: application.id }}>
                View Full Details
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function SimpleReviewCard({
  application,
  onSuccess,
}: {
  application: ApplicationPublic
  onSuccess: () => void
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pendingDecision, setPendingDecision] = useState<ReviewDecision | null>(
    null,
  )
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const mutation = useMutation({
    mutationFn: (decision: ReviewDecision) =>
      ApplicationReviewsService.submitReview({
        applicationId: application.id,
        requestBody: { decision },
      }),
    onSuccess: (_, decision) => {
      const action = decision === "yes" ? "Approved" : "Rejected"
      showSuccessToast(
        `${action}: ${application.human?.first_name} ${application.human?.last_name}`,
      )
      setDialogOpen(false)
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["applications"] }),
  })

  const handleClick = (decision: ReviewDecision) => {
    setPendingDecision(decision)
    setDialogOpen(true)
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Review Decision</CardTitle>
          <CardDescription>
            Submit your review for this application
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button className="w-full" onClick={() => handleClick("yes")}>
            <ThumbsUp className="mr-2 h-4 w-4" />
            Approve
          </Button>
          <Button
            variant="destructive"
            className="w-full"
            onClick={() => handleClick("no")}
          >
            <ThumbsDown className="mr-2 h-4 w-4" />
            Reject
          </Button>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingDecision === "yes" ? "Approve" : "Reject"} Application
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to{" "}
              {pendingDecision === "yes" ? "approve" : "reject"} the application
              from "{application.human?.first_name}{" "}
              {application.human?.last_name}
              "?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <LoadingButton
              variant={pendingDecision === "no" ? "destructive" : "default"}
              loading={mutation.isPending}
              onClick={() =>
                pendingDecision && mutation.mutate(pendingDecision)
              }
            >
              {pendingDecision === "yes" ? "Approve" : "Reject"}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function WeightedVotingCard({
  application,
  onSuccess,
}: {
  application: ApplicationPublic
  onSuccess: () => void
}) {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()
  const [selectedDecision, setSelectedDecision] =
    useState<ReviewDecision | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const mutation = useMutation({
    mutationFn: (decision: ReviewDecision) =>
      ApplicationReviewsService.submitReview({
        applicationId: application.id,
        requestBody: { decision },
      }),
    onSuccess: (_, decision) => {
      showSuccessToast(`Vote submitted: ${decision.replace("_", " ")}`)
      setDialogOpen(false)
      setSelectedDecision(null)
      onSuccess()
    },
    onError: (err) => createErrorHandler(showErrorToast)(err as ApiError),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["applications"] }),
  })

  const handleVote = (decision: ReviewDecision) => {
    setSelectedDecision(decision)
    setDialogOpen(true)
  }

  const labels: Record<ReviewDecision, string> = {
    strong_yes: "Strong Yes",
    yes: "Yes",
    no: "No",
    strong_no: "Strong No",
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cast Your Vote</CardTitle>
          <CardDescription>
            Weighted voting — your vote contributes to the final score
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="w-full border-green-600 text-green-600 hover:bg-green-50 hover:text-green-700"
              onClick={() => handleVote("strong_yes")}
            >
              <ChevronUp className="mr-1 h-4 w-4" />
              <ChevronUp className="-ml-3 h-4 w-4" />
              Strong Yes
            </Button>
            <Button
              variant="outline"
              className="w-full border-green-500 text-green-500 hover:bg-green-50 hover:text-green-600"
              onClick={() => handleVote("yes")}
            >
              <ThumbsUp className="mr-2 h-4 w-4" />
              Yes
            </Button>
            <Button
              variant="outline"
              className="w-full border-red-500 text-red-500 hover:bg-red-50 hover:text-red-600"
              onClick={() => handleVote("no")}
            >
              <ThumbsDown className="mr-2 h-4 w-4" />
              No
            </Button>
            <Button
              variant="outline"
              className="w-full border-red-600 text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => handleVote("strong_no")}
            >
              <ChevronDown className="mr-1 h-4 w-4" />
              <ChevronDown className="-ml-3 h-4 w-4" />
              Strong No
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Confirm Vote: {selectedDecision && labels[selectedDecision]}
            </DialogTitle>
            <DialogDescription>
              Submit your "{selectedDecision && labels[selectedDecision]}" vote
              for "{application.human?.first_name}{" "}
              {application.human?.last_name}"?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <LoadingButton
              variant={
                selectedDecision === "no" || selectedDecision === "strong_no"
                  ? "destructive"
                  : "default"
              }
              loading={mutation.isPending}
              onClick={() =>
                selectedDecision && mutation.mutate(selectedDecision)
              }
            >
              Submit Vote
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ReviewSummaryCard({ summary }: { summary: ReviewSummary }) {
  const positiveVotes = summary.yes_count + summary.strong_yes_count
  const negativeVotes = summary.no_count + summary.strong_no_count

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Review Summary</CardTitle>
        <CardDescription>
          {summary.total_reviews} review{summary.total_reviews !== 1 ? "s" : ""}{" "}
          submitted
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border p-3 text-center">
            <p className="text-2xl font-bold text-green-600">{positiveVotes}</p>
            <p className="text-sm text-muted-foreground">Approve</p>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <p className="text-2xl font-bold text-red-600">{negativeVotes}</p>
            <p className="text-sm text-muted-foreground">Reject</p>
          </div>
        </div>

        {summary.weighted_score !== null &&
          summary.weighted_score !== undefined && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Weighted Score</span>
              <span className="font-medium">{summary.weighted_score}</span>
            </div>
          )}

        {summary.reviews.length > 0 && (
          <div className="space-y-2">
            <Separator />
            <p className="text-sm font-medium">Individual Reviews</p>
            <div className="space-y-2">
              {summary.reviews.map((review) => (
                <div
                  key={review.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <p className="font-medium text-sm">
                      {review.reviewer_full_name ||
                        review.reviewer_email ||
                        "Unknown"}
                    </p>
                    {review.notes && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {review.notes}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={review.decision} />
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
