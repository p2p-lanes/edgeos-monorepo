import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import {
  AlertTriangle,
  EllipsisVertical,
  Eye,
  Plus,
  ThumbsDown,
  ThumbsUp,
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
import { DataTable } from "@/components/Common/DataTable"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

function getApplicationsQueryOptions(popupId: string | null) {
  return {
    queryFn: () =>
      ApplicationsService.listApplications({
        skip: 0,
        limit: 100,
        popupId: popupId || undefined,
      }),
    queryKey: ["applications", popupId],
  }
}

export const Route = createFileRoute("/_layout/applications/")({
  component: Applications,
  head: () => ({
    meta: [{ title: "Applications - EdgeOS" }],
  }),
})

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

// Helper to get badge variant for review decision
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

// Format decision for display
const formatDecision = (decision: string): string => {
  return decision.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

// Review Summary Component
function ReviewSummarySection({ summary }: { summary: ReviewSummary }) {
  const positiveVotes = summary.yes_count + summary.strong_yes_count
  const negativeVotes = summary.no_count + summary.strong_no_count

  return (
    <div className="space-y-3">
      <h4 className="font-medium">Review Summary</h4>

      {/* Vote counts */}
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg border p-2">
          <p className="text-2xl font-bold text-green-600">{positiveVotes}</p>
          <p className="text-xs text-muted-foreground">Approve</p>
        </div>
        <div className="rounded-lg border p-2">
          <p className="text-2xl font-bold text-red-600">{negativeVotes}</p>
          <p className="text-xs text-muted-foreground">Reject</p>
        </div>
      </div>

      {/* Weighted score if applicable */}
      {summary.weighted_score !== null &&
        summary.weighted_score !== undefined && (
          <div className="text-sm text-muted-foreground">
            Weighted Score:{" "}
            <span className="font-medium">{summary.weighted_score}</span>
          </div>
        )}

      {/* Individual reviews */}
      {summary.reviews.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            Reviews ({summary.total_reviews})
          </p>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {summary.reviews.map((review) => (
              <div
                key={review.id}
                className="flex items-center justify-between rounded-lg border p-2 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {review.reviewer_full_name ||
                      review.reviewer_email ||
                      "Unknown"}
                  </p>
                  {review.notes && (
                    <p className="text-xs text-muted-foreground">
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
        <p className="text-sm text-muted-foreground">No reviews yet</p>
      )}
    </div>
  )
}

// View Application Dialog (standalone, state managed by parent)
function ViewApplicationDialog({
  application,
  open,
  onOpenChange,
}: {
  application: ApplicationPublic
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  // Fetch the schema for this popup to get custom field labels
  const { data: schema, isError: _schemaError } = useQuery({
    queryKey: ["form-fields-schema", application.popup_id],
    queryFn: async () => {
      const result = await FormFieldsService.getApplicationSchema({
        popupId: application.popup_id,
      })
      return result as unknown as ApplicationSchema
    },
    enabled: open,
  })

  // Fetch review summary for applications in review or decided
  const {
    data: reviewSummary,
    isLoading: reviewsLoading,
    isError: _reviewsError,
  } = useQuery({
    queryKey: ["review-summary", application.id],
    queryFn: () =>
      ApplicationReviewsService.getReviewSummary({
        applicationId: application.id,
      }),
    enabled: open && application.status !== "draft",
  })

  // Helper to get the label for a custom field
  const getFieldLabel = (fieldName: string): string => {
    if (schema?.custom_fields?.[fieldName]?.label) {
      return schema.custom_fields[fieldName].label
    }
    // Fallback: convert snake_case to Title Case
    return fieldName
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  }

  // Helper to format custom field value based on type
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Application Details</DialogTitle>
          <DialogDescription>
            {application.human?.first_name} {application.human?.last_name}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Email</p>
              <p>{application.human?.email}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Status
              </p>
              <Badge variant={getStatusBadgeVariant(application.status)}>
                {application.status}
              </Badge>
            </div>
            {application.human?.telegram && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Telegram
                </p>
                <p>{application.human.telegram}</p>
              </div>
            )}
            {application.human?.organization && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Organization
                </p>
                <p>{application.human.organization}</p>
              </div>
            )}
            {application.human?.role && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Role
                </p>
                <p>{application.human.role}</p>
              </div>
            )}
            {application.human?.gender && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Gender
                </p>
                <p>{application.human.gender}</p>
              </div>
            )}
            {application.human?.age && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Age</p>
                <p>{application.human.age}</p>
              </div>
            )}
            {application.human?.residence && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Residence
                </p>
                <p>{application.human.residence}</p>
              </div>
            )}
            {application.referral && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Referral
                </p>
                <p>{application.referral}</p>
              </div>
            )}
          </div>

          {application.custom_fields &&
            Object.keys(application.custom_fields).length > 0 && (
              <>
                <hr />
                <div>
                  <h4 className="font-medium mb-2">Custom Fields</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {Object.entries(application.custom_fields).map(
                      ([key, value]) => (
                        <div key={key}>
                          <p className="text-sm font-medium text-muted-foreground">
                            {getFieldLabel(key)}
                          </p>
                          <p>{formatFieldValue(key, value)}</p>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              </>
            )}

          {application.attendees && application.attendees.length > 0 && (
            <>
              <hr />
              <div>
                <h4 className="font-medium mb-2">
                  Attendees ({application.attendees.length})
                </h4>
                <div className="space-y-2">
                  {application.attendees.map((attendee) => (
                    <div
                      key={attendee.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div>
                        <p className="font-medium">{attendee.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {attendee.email} • {attendee.category}
                        </p>
                      </div>
                      <span className="font-mono text-xs text-muted-foreground">
                        {attendee.check_in_code}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-muted-foreground">
            {application.submitted_at && (
              <div>
                Submitted: {new Date(application.submitted_at).toLocaleString()}
              </div>
            )}
            {application.accepted_at && (
              <div>
                Accepted: {new Date(application.accepted_at).toLocaleString()}
              </div>
            )}
          </div>

          {/* Review Summary Section */}
          {application.status !== "draft" && (
            <>
              <hr />
              {reviewsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : reviewSummary ? (
                <ReviewSummarySection summary={reviewSummary} />
              ) : null}
            </>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Submit Review Dialog (follows approval flow)
function SubmitReviewDialog({
  application,
  decision,
  label,
  variant = "default",
  open,
  onOpenChange,
}: {
  application: ApplicationPublic
  decision: ReviewDecision
  label: string
  variant?: "default" | "destructive"
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
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
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["applications"] }),
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

type DialogType = "view" | "approve" | "reject" | null

// Actions Menu - dialogs rendered outside dropdown to persist state
function ApplicationActionsMenu({
  application,
}: {
  application: ApplicationPublic
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [activeDialog, setActiveDialog] = useState<DialogType>(null)
  const { isAdmin } = useAuth()
  const currentStatus = application.status

  const openDialog = (dialog: DialogType) => {
    setDropdownOpen(false)
    setActiveDialog(dialog)
  }

  // Only show review actions for applications that are in review (not draft, not already decided)
  const canReview = isAdmin && currentStatus === "in review"

  return (
    <>
      <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Application actions">
            <EllipsisVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => openDialog("view")}>
            <Eye className="mr-2 h-4 w-4" />
            View Details
          </DropdownMenuItem>

          {canReview && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => openDialog("approve")}>
                <ThumbsUp className="mr-2 h-4 w-4" />
                Approve
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => openDialog("reject")}
              >
                <ThumbsDown className="mr-2 h-4 w-4" />
                Reject
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Dialogs rendered outside dropdown so state persists when dropdown closes */}
      <ViewApplicationDialog
        application={application}
        open={activeDialog === "view"}
        onOpenChange={(open) => !open && setActiveDialog(null)}
      />
      <SubmitReviewDialog
        application={application}
        decision="yes"
        label="Approve"
        open={activeDialog === "approve"}
        onOpenChange={(open) => !open && setActiveDialog(null)}
      />
      <SubmitReviewDialog
        application={application}
        decision="no"
        label="Reject"
        variant="destructive"
        open={activeDialog === "reject"}
        onOpenChange={(open) => !open && setActiveDialog(null)}
      />
    </>
  )
}

const columns: ColumnDef<ApplicationPublic>[] = [
  {
    accessorKey: "human.first_name",
    header: "Name",
    cell: ({ row }) => (
      <span className="font-medium">
        {row.original.human?.first_name} {row.original.human?.last_name}
      </span>
    ),
  },
  {
    accessorKey: "human.email",
    header: "Email",
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.human?.email}</span>
    ),
  },
  {
    accessorKey: "human.organization",
    header: "Organization",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.human?.organization || "N/A"}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={getStatusBadgeVariant(row.original.status)}>
        {row.original.status}
      </Badge>
    ),
  },
  {
    accessorKey: "attendees",
    header: "Attendees",
    cell: ({ row }) => <span>{row.original.attendees?.length ?? 0}</span>,
  },
  {
    accessorKey: "red_flag",
    header: "Flagged",
    cell: ({ row }) =>
      row.original.red_flag ? (
        <Badge variant="destructive">
          <AlertTriangle className="mr-1 h-3 w-3" />
          Flagged
        </Badge>
      ) : null,
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <ApplicationActionsMenu application={row.original} />
      </div>
    ),
  },
]

function ApplicationsTableContent() {
  const { selectedPopupId } = useWorkspace()
  const { data: applications } = useSuspenseQuery(
    getApplicationsQueryOptions(selectedPopupId),
  )
  return <DataTable columns={columns} data={applications.results} />
}

// Add Application Button (Superadmin only - for testing)
function AddApplicationButton() {
  return (
    <Button asChild>
      <Link to="/applications/new">
        <Plus className="mr-2 h-4 w-4" />
        Create Application
      </Link>
    </Button>
  )
}

function Applications() {
  const { isSuperadmin } = useAuth()
  const { isContextReady } = useWorkspace()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Applications</h1>
          <p className="text-muted-foreground">
            Review and manage registration applications
          </p>
        </div>
        {isSuperadmin && isContextReady && <AddApplicationButton />}
      </div>
      {!isContextReady ? (
        <WorkspaceAlert resource="applications" />
      ) : (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <ApplicationsTableContent />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
