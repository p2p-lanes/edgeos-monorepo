import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import {
  AlertTriangle,
  ClipboardList,
  Download,
  EllipsisVertical,
  Eye,
  ListChecks,
  Plus,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react"
import { Suspense, useState } from "react"

import {
  type ApiError,
  type ApplicationPublic,
  ApplicationReviewsService,
  ApplicationsService,
  ApprovalStrategiesService,
  type ReviewDecision,
} from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { StatusBadge } from "@/components/Common/StatusBadge"
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
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import { exportToCsv, fetchAllPages } from "@/lib/export"
import { createErrorHandler } from "@/utils"

function getApplicationsQueryOptions(
  popupId: string | null,
  page: number,
  pageSize: number,
  search?: string,
) {
  return {
    queryFn: () =>
      ApplicationsService.listApplications({
        skip: page * pageSize,
        limit: pageSize,
        popupId: popupId || undefined,
        search: search || undefined,
      }),
    queryKey: ["applications", popupId, { page, pageSize, search }],
  }
}

export const Route = createFileRoute("/_layout/applications/")({
  component: Applications,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [{ title: "Applications - EdgeOS" }],
  }),
})

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
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["applications"] })
      const previousData = queryClient.getQueriesData({
        queryKey: ["applications"],
      })
      const newStatus =
        decision === "yes" || decision === "strong_yes"
          ? "accepted"
          : "rejected"
      queryClient.setQueriesData(
        { queryKey: ["applications"] },
        (
          old:
            | {
                results: ApplicationPublic[]
                paging: { limit: number; offset: number; total: number }
              }
            | undefined,
        ) => {
          if (!old?.results) return old
          return {
            ...old,
            results: old.results.map((a) =>
              a.id === application.id ? { ...a, status: newStatus } : a,
            ),
          }
        },
      )
      return { previousData }
    },
    onSuccess: () => {
      showSuccessToast(`Review submitted: ${decision.replace("_", " ")}`)
      onOpenChange(false)
    },
    onError: (err, _, context) => {
      context?.previousData?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data)
      })
      createErrorHandler(showErrorToast)(err as ApiError)
    },
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

function ApplicationActionsMenu({
  application,
  isWeightedVoting = false,
}: {
  application: ApplicationPublic
  isWeightedVoting?: boolean
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

  const canReview =
    isAdmin && currentStatus === "in review" && !isWeightedVoting

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

const getColumns = (
  isWeightedVoting: boolean,
): ColumnDef<ApplicationPublic>[] => [
  {
    accessorKey: "human.first_name",
    header: ({ column }) => <SortableHeader label="Name" column={column} />,
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
    header: ({ column }) => <SortableHeader label="Email" column={column} />,
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
    header: ({ column }) => <SortableHeader label="Status" column={column} />,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
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
        <ApplicationActionsMenu
          application={row.original}
          isWeightedVoting={isWeightedVoting}
        />
      </div>
    ),
  },
]

function ApplicationsTableContent() {
  const { selectedPopupId } = useWorkspace()
  const { isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const searchParams = Route.useSearch()
  const { search, pagination, setSearch, setPagination } = useTableSearchParams(
    searchParams,
    "/applications",
  )

  const { data: applications } = useSuspenseQuery(
    getApplicationsQueryOptions(
      selectedPopupId,
      pagination.pageIndex,
      pagination.pageSize,
      search,
    ),
  )

  const { data: approvalStrategy } = useQuery({
    queryKey: ["approval-strategy", selectedPopupId],
    queryFn: () =>
      ApprovalStrategiesService.getApprovalStrategy({
        popupId: selectedPopupId!,
      }),
    enabled: !!selectedPopupId,
    retry: false,
  })

  const bulkReviewMutation = useMutation({
    mutationFn: async ({
      ids,
      decision,
    }: {
      ids: string[]
      decision: ReviewDecision
    }) => {
      await Promise.all(
        ids.map((id) =>
          ApplicationReviewsService.submitReview({
            applicationId: id,
            requestBody: { decision },
          }),
        ),
      )
    },
    onMutate: async ({ ids, decision }) => {
      await queryClient.cancelQueries({ queryKey: ["applications"] })
      const previousData = queryClient.getQueriesData({
        queryKey: ["applications"],
      })
      const idSet = new Set(ids)
      const newStatus =
        decision === "yes" || decision === "strong_yes"
          ? "accepted"
          : "rejected"
      queryClient.setQueriesData(
        { queryKey: ["applications"] },
        (
          old:
            | {
                results: ApplicationPublic[]
                paging: { limit: number; offset: number; total: number }
              }
            | undefined,
        ) => {
          if (!old?.results) return old
          return {
            ...old,
            results: old.results.map((a) =>
              idSet.has(a.id) ? { ...a, status: newStatus } : a,
            ),
          }
        },
      )
      return { previousData }
    },
    onSuccess: (_, { ids, decision }) => {
      const action = decision === "yes" ? "approved" : "rejected"
      showSuccessToast(`${ids.length} application(s) ${action}`)
    },
    onError: (err, _, context) => {
      context?.previousData?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data)
      })
      createErrorHandler(showErrorToast)(err as ApiError)
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["applications"] }),
  })

  const isWeightedVoting = approvalStrategy?.strategy_type === "weighted"
  const columns = getColumns(isWeightedVoting)
  const canBulkReview = isAdmin && !isWeightedVoting

  return (
    <DataTable
      columns={columns}
      data={applications.results}
      searchPlaceholder="Search by name, email, or organization..."
      hiddenOnMobile={["human.organization", "attendees", "red_flag"]}
      searchValue={search}
      onSearchChange={setSearch}
      serverPagination={{
        total: applications.paging.total,
        pagination: pagination,
        onPaginationChange: setPagination,
      }}
      emptyState={
        !search ? (
          <EmptyState
            icon={ClipboardList}
            title="No applications yet"
            description="Applications will appear here once people apply to your popup."
          />
        ) : undefined
      }
      selectable={canBulkReview}
      bulkActions={
        canBulkReview
          ? (selectedRows) => {
              const reviewable = (selectedRows as ApplicationPublic[]).filter(
                (app) => app.status === "in review",
              )
              return (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={
                      reviewable.length === 0 || bulkReviewMutation.isPending
                    }
                    onClick={() =>
                      bulkReviewMutation.mutate({
                        ids: reviewable.map((a) => a.id),
                        decision: "yes",
                      })
                    }
                  >
                    <ThumbsUp className="mr-1.5 h-3.5 w-3.5" />
                    Approve ({reviewable.length})
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={
                      reviewable.length === 0 || bulkReviewMutation.isPending
                    }
                    onClick={() =>
                      bulkReviewMutation.mutate({
                        ids: reviewable.map((a) => a.id),
                        decision: "no",
                      })
                    }
                  >
                    <ThumbsDown className="mr-1.5 h-3.5 w-3.5" />
                    Reject ({reviewable.length})
                  </Button>
                </div>
              )
            }
          : undefined
      }
    />
  )
}

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
  const { isAdmin, isSuperadmin } = useAuth()
  const { isContextReady, selectedPopupId } = useWorkspace()
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    if (!selectedPopupId) return
    setIsExporting(true)
    try {
      const results = await fetchAllPages((skip, limit) =>
        ApplicationsService.listApplications({
          skip,
          limit,
          popupId: selectedPopupId,
        }),
      )
      exportToCsv(
        "applications",
        results as unknown as Record<string, unknown>[],
        [
          { key: "human.first_name", label: "First Name" },
          { key: "human.last_name", label: "Last Name" },
          { key: "human.email", label: "Email" },
          { key: "human.organization", label: "Organization" },
          { key: "status", label: "Status" },
        ],
      )
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Applications</h1>
          <p className="text-muted-foreground">
            Review and manage registration applications
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isContextReady && isAdmin && (
            <Button variant="outline" asChild>
              <Link to="/applications/review-queue">
                <ListChecks className="mr-2 h-4 w-4" />
                Review Queue
              </Link>
            </Button>
          )}
          {isContextReady && (
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={isExporting}
            >
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? "Exporting..." : "Export CSV"}
            </Button>
          )}
          {isSuperadmin && isContextReady && <AddApplicationButton />}
        </div>
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
