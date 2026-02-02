import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  AlertTriangle,
  ArrowLeft,
  Building,
  Calendar,
  Mail,
  MapPin,
  MessageCircle,
  ThumbsDown,
  ThumbsUp,
  User,
  Users,
} from "lucide-react"
import { Suspense, useState } from "react"

import {
  type ApplicationPublic,
  ApplicationReviewsService,
  ApplicationsService,
  FormFieldsService,
  type ReviewDecision,
  type ReviewSummary,
} from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
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
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

export const Route = createFileRoute("/_layout/applications/$id")({
  component: ViewApplicationPage,
  head: () => ({
    meta: [{ title: "Application Details - EdgeOS" }],
  }),
})

// Type for the application schema response
interface FormFieldSchema {
  type: string
  label: string
  required: boolean
  section: string
  position?: number
  options?: string[]
  placeholder?: string
  help_text?: string
}

interface ApplicationSchema {
  base_fields: Record<string, FormFieldSchema>
  custom_fields: Record<string, FormFieldSchema>
  sections: string[]
}

function getApplicationQueryOptions(applicationId: string) {
  return {
    queryKey: ["applications", applicationId],
    queryFn: () => ApplicationsService.getApplication({ applicationId }),
  }
}

const getStatusBadgeVariant = (
  status: string,
): "default" | "secondary" | "destructive" | "outline" => {
  switch (status) {
    case "accepted":
      return "default"
    case "in review":
      return "secondary"
    case "rejected":
      return "destructive"
    default:
      return "outline"
  }
}

const getDecisionBadgeVariant = (
  decision: string,
): "default" | "secondary" | "destructive" | "outline" => {
  switch (decision) {
    case "strong_yes":
    case "yes":
      return "default"
    case "strong_no":
    case "no":
      return "destructive"
    default:
      return "outline"
  }
}

const formatDecision = (decision: string): string => {
  return decision.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

// Review Summary Component
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
        {/* Vote counts */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border p-3 text-center">
            <p className="text-3xl font-bold text-green-600">{positiveVotes}</p>
            <p className="text-sm text-muted-foreground">Approve</p>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <p className="text-3xl font-bold text-red-600">{negativeVotes}</p>
            <p className="text-sm text-muted-foreground">Reject</p>
          </div>
        </div>

        {/* Weighted score if applicable */}
        {summary.weighted_score !== null &&
          summary.weighted_score !== undefined && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Weighted Score</span>
              <span className="font-medium">{summary.weighted_score}</span>
            </div>
          )}

        {/* Individual reviews */}
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
                  <Badge variant={getDecisionBadgeVariant(review.decision)}>
                    {formatDecision(review.decision)}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {summary.total_reviews === 0 && (
          <p className="text-sm text-muted-foreground text-center py-2">
            No reviews yet
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// Submit Review Dialog
function SubmitReviewDialog({
  application,
  decision,
  label,
  variant = "default",
  open,
  onOpenChange,
  onSuccess,
}: {
  application: ApplicationPublic
  decision: ReviewDecision
  label: string
  variant?: "default" | "destructive"
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const mutation = useMutation({
    mutationFn: () =>
      ApplicationReviewsService.submitReview({
        applicationId: application.id,
        requestBody: { decision },
      }),
    onSuccess: () => {
      showSuccessToast(`Review submitted: ${decision.replace("_", " ")}`)
      onOpenChange(false)
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
  })

  const actionVerb =
    decision === "yes" || decision === "strong_yes" ? "approve" : "reject"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            Are you sure you want to {actionVerb} the application from "
            {application.human?.first_name} {application.human?.last_name}"?
            This will submit your review and may update the application status
            based on the approval strategy.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <LoadingButton
            variant={variant}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {label}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ViewApplicationContent({ applicationId }: { applicationId: string }) {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const { data: application, refetch } = useSuspenseQuery(
    getApplicationQueryOptions(applicationId),
  )

  const [approveDialogOpen, setApproveDialogOpen] = useState(false)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)

  // Fetch the schema for custom field labels
  const { data: schema } = useQuery({
    queryKey: ["form-fields-schema", application.popup_id],
    queryFn: async () => {
      const result = await FormFieldsService.getApplicationSchema({
        popupId: application.popup_id,
      })
      return result as unknown as ApplicationSchema
    },
  })

  // Fetch review summary
  const { data: reviewSummary, refetch: refetchReviews } = useQuery({
    queryKey: ["review-summary", application.id],
    queryFn: () =>
      ApplicationReviewsService.getReviewSummary({
        applicationId: application.id,
      }),
    enabled: application.status !== "draft",
  })

  const getFieldLabel = (fieldName: string): string => {
    if (schema?.custom_fields?.[fieldName]?.label) {
      return schema.custom_fields[fieldName].label
    }
    return fieldName
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  }

  const formatFieldValue = (fieldName: string, value: unknown): string => {
    if (value === null || value === undefined) return "—"

    const fieldDef = schema?.custom_fields?.[fieldName]
    const fieldType = fieldDef?.type

    if (fieldType === "boolean") {
      return value ? "Yes" : "No"
    }
    if (fieldType === "multiselect" && Array.isArray(value)) {
      return value.join(", ")
    }
    if (fieldType === "date" && typeof value === "string") {
      return new Date(value).toLocaleDateString()
    }

    return String(value)
  }

  const canReview = isAdmin && application.status === "in review"

  const handleReviewSuccess = () => {
    refetch()
    refetchReviews()
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column - Main Content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Applicant Information */}
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
                    <Badge variant="destructive">
                      <AlertTriangle className="mr-1 h-3 w-3" />
                      Flagged
                    </Badge>
                  )}
                  <Badge variant={getStatusBadgeVariant(application.status)}>
                    {application.status}
                  </Badge>
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
                      <p className="font-medium">
                        {application.human.residence}
                      </p>
                    </div>
                  </div>
                )}
                {application.human?.telegram && (
                  <div className="flex items-start gap-2">
                    <MessageCircle className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm text-muted-foreground">Telegram</p>
                      <p className="font-medium">
                        {application.human.telegram}
                      </p>
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
              </div>
            </CardContent>
          </Card>

          {/* Custom Fields */}
          {application.custom_fields &&
            Object.keys(application.custom_fields).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Custom Fields</CardTitle>
                  <CardDescription>
                    Additional information provided by the applicant
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {Object.entries(application.custom_fields).map(
                      ([key, value]) => (
                        <div key={key}>
                          <p className="text-sm text-muted-foreground">
                            {getFieldLabel(key)}
                          </p>
                          <p className="font-medium">
                            {formatFieldValue(key, value)}
                          </p>
                        </div>
                      ),
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

          {/* Attendees */}
          {application.attendees && application.attendees.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Attendees ({application.attendees.length})
                  </div>
                </CardTitle>
                <CardDescription>
                  People registered under this application
                </CardDescription>
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

        {/* Right Column - Status & Actions */}
        <div className="space-y-6">
          {/* Review Actions */}
          {canReview && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Review Actions</CardTitle>
                <CardDescription>Submit your review decision</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  className="w-full"
                  onClick={() => setApproveDialogOpen(true)}
                >
                  <ThumbsUp className="mr-2 h-4 w-4" />
                  Approve
                </Button>
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => setRejectDialogOpen(true)}
                >
                  <ThumbsDown className="mr-2 h-4 w-4" />
                  Reject
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Review Summary */}
          {application.status !== "draft" && reviewSummary && (
            <ReviewSummaryCard summary={reviewSummary} />
          )}

          {/* Timeline / Dates */}
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
              {application.accepted_at && (
                <div className="flex items-start gap-2">
                  <Calendar className="h-4 w-4 text-green-600 mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">Accepted</p>
                    <p className="text-sm font-medium">
                      {new Date(application.accepted_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              )}
              <Separator />
              <div>
                <p className="text-sm text-muted-foreground">Application ID</p>
                <code className="text-xs text-muted-foreground">
                  {application.id}
                </code>
              </div>
            </CardContent>
          </Card>

          {/* Back Button */}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => navigate({ to: "/applications" })}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Applications
          </Button>
        </div>
      </div>

      {/* Review Dialogs */}
      <SubmitReviewDialog
        application={application}
        decision="yes"
        label="Approve"
        open={approveDialogOpen}
        onOpenChange={setApproveDialogOpen}
        onSuccess={handleReviewSuccess}
      />
      <SubmitReviewDialog
        application={application}
        decision="no"
        label="Reject"
        variant="destructive"
        open={rejectDialogOpen}
        onOpenChange={setRejectDialogOpen}
        onSuccess={handleReviewSuccess}
      />
    </div>
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
