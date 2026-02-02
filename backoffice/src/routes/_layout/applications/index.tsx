import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
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
  type ReviewDecision,
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

type DialogType = "approve" | "reject" | null

// Actions Menu - dialogs rendered outside dropdown to persist state
function ApplicationActionsMenu({
  application,
}: {
  application: ApplicationPublic
}) {
  const navigate = useNavigate()
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
          <DropdownMenuItem
            onSelect={() => {
              setDropdownOpen(false)
              navigate({
                to: "/applications/$id",
                params: { id: application.id },
              })
            }}
          >
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
      <Link
        to="/applications/$id"
        params={{ id: row.original.id }}
        className="font-medium hover:underline"
      >
        {row.original.human?.first_name} {row.original.human?.last_name}
      </Link>
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
