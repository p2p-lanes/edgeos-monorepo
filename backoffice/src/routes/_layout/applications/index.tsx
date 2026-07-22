import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import {
  ClipboardList,
  Download,
  EllipsisVertical,
  ExternalLink,
  Flag,
  ListChecks,
  MessageSquare,
  Plus,
  Star,
  ThumbsDown,
  ThumbsUp,
  Users,
} from "lucide-react"
import { Suspense, useCallback, useEffect, useMemo, useState } from "react"

import {
  type ApiError,
  type ApplicationPublic,
  type ApplicationReviewerVote,
  ApplicationReviewsService,
  type ApplicationStatus,
  ApplicationsService,
  ApprovalStrategiesService,
  DashboardService,
  FormFieldsService,
  type HumanRating,
  HumansService,
  type PopupReviewerPublic,
  PopupReviewersService,
  PopupsService,
  type ReviewDecision,
} from "@/client"
import {
  type ApplicationsView,
  ApplicationsViewSwitcher,
} from "@/components/applications/ApplicationsViewSwitcher"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import {
  type TableSearchParams,
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import { exportToCsv, fetchAllPages } from "@/lib/export"
import { cn } from "@/lib/utils"
import { createErrorHandler } from "@/utils"

/** Schema shape returned by FormFieldsService.getApplicationSchema */
interface ApplicationSchema {
  custom_fields: Record<
    string,
    {
      label: string
      type?: string
      position?: number
      options?: string[]
      [key: string]: unknown
    }
  >
}

const APPLICATIONS_VIEW_STORAGE_KEY = "edgeos:applications-view"
const VALID_APPLICATIONS_VIEWS = new Set<ApplicationsView>(["default", "wide"])

function readStoredApplicationsView(): ApplicationsView {
  if (typeof window === "undefined") return "default"
  const raw = localStorage.getItem(APPLICATIONS_VIEW_STORAGE_KEY)
  return raw && VALID_APPLICATIONS_VIEWS.has(raw as ApplicationsView)
    ? (raw as ApplicationsView)
    : "default"
}

function formatCustomFieldValue(value: unknown, type?: string): string {
  if (value === null || value === undefined || value === "") return "—"
  if (type === "boolean") return value ? "Yes" : "No"
  if (type === "multiselect" && Array.isArray(value)) return value.join(", ")
  if (type === "signature") {
    const sig = value as { signature?: string }
    return sig?.signature ? "Signed" : "—"
  }
  if (type === "date" && typeof value === "string") {
    return new Date(value).toLocaleDateString()
  }
  if (Array.isArray(value)) return value.join(", ")
  if (typeof value === "object") return "—"
  return String(value)
}

// Build one toggleable, hidden-by-default column per custom form-builder
// field so operators can surface any dynamic attribute from the toggle
// columns menu. Ordered by the schema position, matching the form builder.
function buildCustomFieldColumns(
  formSchema?: ApplicationSchema,
): ColumnDef<ApplicationPublic>[] {
  const customFields = formSchema?.custom_fields ?? {}
  return Object.entries(customFields)
    .sort(
      ([, a], [, b]) =>
        (a.position ?? Number.MAX_SAFE_INTEGER) -
        (b.position ?? Number.MAX_SAFE_INTEGER),
    )
    .map(([name, def]) => {
      const label = def.label || name
      return {
        id: `custom_${name}`,
        accessorFn: (row) => row.custom_fields?.[name],
        header: label,
        meta: { label, toggleable: true, defaultHidden: true },
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatCustomFieldValue(
              row.original.custom_fields?.[name],
              def.type,
            )}
          </span>
        ),
      } satisfies ColumnDef<ApplicationPublic>
    })
}

const APPLICATION_STATUS_OPTIONS: {
  value: ApplicationStatus
  label: string
}[] = [
  { value: "draft", label: "Draft" },
  { value: "pending_fee", label: "Pending Fee" },
  { value: "in review", label: "In Review" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
]

function getApplicationsQueryOptions(
  popupId: string | null,
  page: number,
  pageSize: number,
  search?: string,
  statusFilter?: ApplicationStatus,
  reviewedBy?: string,
) {
  return {
    queryFn: () =>
      ApplicationsService.listApplications({
        skip: page * pageSize,
        limit: pageSize,
        popupId: popupId || undefined,
        reviewedBy: reviewedBy || undefined,
        search: search || undefined,
        statusFilter: statusFilter || undefined,
      }),
    queryKey: [
      "applications",
      popupId,
      { page, pageSize, search, statusFilter, reviewedBy },
    ],
  }
}

function useStatusCounts(popupId: string | null) {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["dashboard", "stats", popupId],
    queryFn: () => DashboardService.getDashboardStats({ popupId: popupId! }),
    enabled: !!popupId,
  })

  const counts: Partial<Record<ApplicationStatus, number>> = {}
  if (stats?.applications) {
    const a = stats.applications
    counts.draft = a.draft ?? 0
    counts.pending_fee = a.pending_fee ?? 0
    counts["in review"] = a.in_review ?? 0
    counts.accepted = a.accepted ?? 0
    counts.rejected = a.rejected ?? 0
    counts.withdrawn = a.withdrawn ?? 0
  }
  const total = stats?.applications?.total ?? 0

  return { counts, total, isLoading }
}

function StatusDropdownFilter({
  popupId,
  requiresApplicationFee,
  selected,
  onSelect,
}: {
  popupId: string | null
  requiresApplicationFee?: boolean
  selected: ApplicationStatus | undefined
  onSelect: (value: ApplicationStatus | undefined) => void
}) {
  const { counts, total } = useStatusCounts(popupId)
  const statusOptions =
    requiresApplicationFee === false
      ? APPLICATION_STATUS_OPTIONS.filter((opt) => opt.value !== "pending_fee")
      : APPLICATION_STATUS_OPTIONS
  const selectedOption = selected
    ? statusOptions.find((option) => option.value === selected)
    : undefined

  const options = [
    { value: "all" as const, label: "All", count: total },
    ...statusOptions.map((opt) => ({
      value: opt.value,
      label: opt.label,
      count: counts[opt.value] ?? 0,
    })),
  ]

  const currentLabel = selectedOption?.label ?? "All"
  const currentCount = selectedOption
    ? (counts[selectedOption.value] ?? 0)
    : total

  return (
    <Select
      value={selectedOption?.value ?? "all"}
      onValueChange={(v) =>
        onSelect(v === "all" ? undefined : (v as ApplicationStatus))
      }
    >
      <SelectTrigger className="h-9 w-[180px]">
        <SelectValue>
          {currentLabel} ({currentCount})
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem
            key={opt.value === "all" ? "all" : opt.value}
            value={opt.value === "all" ? "all" : opt.value}
          >
            <span className="flex w-full items-center justify-between gap-4">
              <span>{opt.label}</span>
              <span className="text-muted-foreground tabular-nums">
                {opt.count}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ReviewerDropdownFilter({
  reviewers,
  selected,
  onSelect,
  disabled = false,
}: {
  reviewers: PopupReviewerPublic[]
  selected: string | undefined
  onSelect: (value: string | undefined) => void
  disabled?: boolean
}) {
  const selectedReviewer = selected
    ? reviewers.find((reviewer) => reviewer.user_id === selected)
    : undefined

  const currentLabel = disabled
    ? "No reviewers"
    : (selectedReviewer?.user_full_name ??
      selectedReviewer?.user_email ??
      "All reviewers")

  return (
    <Select
      value={selected ?? "all"}
      onValueChange={(value) => onSelect(value === "all" ? undefined : value)}
      disabled={disabled}
    >
      <SelectTrigger className="h-9 w-[220px]">
        <SelectValue>{currentLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All reviewers</SelectItem>
        {reviewers.map((reviewer) => (
          <SelectItem key={reviewer.id} value={reviewer.user_id}>
            {reviewer.user_full_name ??
              reviewer.user_email ??
              "Unknown reviewer"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const VALID_STATUSES: Set<string> = new Set([
  "draft",
  "pending_fee",
  "in review",
  "accepted",
  "rejected",
])

type ApplicationsSearchParams = TableSearchParams & {
  reviewerId?: string
  status?: ApplicationStatus
}

export const Route = createFileRoute("/_layout/applications/")({
  component: Applications,
  validateSearch: (raw: Record<string, unknown>): ApplicationsSearchParams => ({
    ...validateTableSearch(raw),
    ...(typeof raw.status === "string" && VALID_STATUSES.has(raw.status)
      ? { status: raw.status as ApplicationStatus }
      : {}),
    ...(typeof raw.reviewerId === "string" && raw.reviewerId
      ? { reviewerId: raw.reviewerId }
      : {}),
  }),
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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["applications"] })
      queryClient.invalidateQueries({
        queryKey: ["dashboard", "stats", application.popup_id],
      })
    },
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
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [activeDialog, setActiveDialog] = useState<DialogType>(null)
  const { isOperatorOrAbove } = useAuth()
  const currentStatus = application.status

  const openDialog = (dialog: DialogType) => {
    setDropdownOpen(false)
    setActiveDialog(dialog)
  }

  const canReview =
    isOperatorOrAbove && currentStatus === "in review" && !isWeightedVoting

  if (!canReview) return null

  return (
    <>
      <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Application actions">
            <EllipsisVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
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

const RATING_STYLES: Record<
  HumanRating,
  { label: string; className: string; icon: "flag" | "star" } | null
> = {
  unrated: null,
  red_flag: { label: "Red flag", className: "text-red-600", icon: "flag" },
  orange_flag: {
    label: "Orange flag",
    className: "text-orange-500",
    icon: "flag",
  },
  green_flag: {
    label: "Green flag",
    className: "text-green-600",
    icon: "flag",
  },
  star: { label: "Star", className: "text-amber-500", icon: "star" },
}

function RatingBadge({ rating }: { rating?: HumanRating }) {
  const style = rating ? RATING_STYLES[rating] : null
  if (!style) return <span className="text-muted-foreground">—</span>
  const Icon = style.icon === "star" ? Star : Flag
  return (
    <span className="inline-flex items-center" title={style.label}>
      <Icon
        className={cn(
          "h-4 w-4",
          style.className,
          style.icon === "star" && "fill-current",
        )}
      />
    </span>
  )
}

const DECISION_LABELS: Record<ReviewDecision, string> = {
  strong_yes: "Strong yes",
  yes: "Yes",
  no: "No",
  strong_no: "Strong no",
}

function decisionDotClass(decision: ReviewDecision): string {
  return decision === "yes" || decision === "strong_yes"
    ? "bg-green-500"
    : "bg-red-500"
}

function ReviewsCell({
  count,
  reviewers,
}: {
  count: number
  reviewers: ApplicationReviewerVote[]
}) {
  if (!count) return <span className="text-muted-foreground">—</span>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-no-row-click
          className="inline-flex cursor-default items-center gap-1 rounded-md border px-2 py-0.5 text-xs"
        >
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          {count}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <div className="flex flex-col gap-1">
          {reviewers.length === 0 ? (
            <span>
              {count} review{count === 1 ? "" : "s"}
            </span>
          ) : (
            reviewers.map((r) => (
              <div key={r.reviewer_id} className="flex items-center gap-2">
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    decisionDotClass(r.decision),
                  )}
                />
                <span className="font-medium">
                  {r.reviewer_full_name ??
                    r.reviewer_email ??
                    "Unknown reviewer"}
                </span>
                <span className="text-muted-foreground">
                  {DECISION_LABELS[r.decision]}
                </span>
              </div>
            ))
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function CommentsCell({ humanId, count }: { humanId: string; count: number }) {
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ["human-comments", humanId],
    queryFn: () => HumansService.listHumanComments({ humanId }),
    enabled: open,
  })

  if (!count) return <span className="text-muted-foreground">—</span>

  const comments = data?.results ?? []
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-no-row-click
          className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {count}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0" data-no-row-click>
        <div className="max-h-72 space-y-3 overflow-y-auto p-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No comments</p>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="space-y-0.5">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {c.author_name || c.author_email || "Unknown"}
                  </span>
                  <span>{new Date(c.created_at).toLocaleString()}</span>
                </div>
                <p className="whitespace-pre-line break-words text-sm">
                  {c.body}
                </p>
              </div>
            ))
          )}
        </div>
        <div className="border-t p-2">
          <Link
            to="/humans/$id"
            params={{ id: humanId }}
            className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            View profile
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}

const getColumns = (
  isWeightedVoting: boolean,
  showReviewerDecision: boolean,
  customColumns: ColumnDef<ApplicationPublic>[] = [],
): ColumnDef<ApplicationPublic>[] => [
  {
    accessorKey: "human.first_name",
    header: ({ column }) => <SortableHeader label="Name" column={column} />,
    meta: { label: "Name", toggleable: false, sticky: "left" },
    cell: ({ row }) => (
      // Name links to the human; the rest of the row opens the application.
      // Without this, comments is the only path from an application to its human.
      <Link
        to="/humans/$id"
        params={{ id: row.original.human_id }}
        className="font-medium hover:underline"
      >
        {row.original.human?.first_name} {row.original.human?.last_name}
      </Link>
    ),
  },
  {
    accessorKey: "human.email",
    header: ({ column }) => <SortableHeader label="Email" column={column} />,
    meta: { label: "Email", toggleable: true },
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.human?.email}</span>
    ),
  },
  {
    accessorKey: "status",
    header: ({ column }) => <SortableHeader label="Status" column={column} />,
    meta: { label: "Status", toggleable: true },
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    id: "reviews",
    header: "Reviews",
    meta: { label: "Reviews", toggleable: true },
    enableSorting: false,
    cell: ({ row }) => (
      <ReviewsCell
        count={row.original.review_count ?? 0}
        reviewers={row.original.reviewers ?? []}
      />
    ),
  },
  {
    id: "comments",
    header: "Comments",
    meta: { label: "Comments", toggleable: true },
    enableSorting: false,
    cell: ({ row }) => (
      <CommentsCell
        humanId={row.original.human_id}
        count={row.original.comment_count ?? 0}
      />
    ),
  },
  {
    accessorKey: "attendees",
    header: "Companions",
    meta: { label: "Companions", toggleable: true },
    cell: ({ row }) => {
      const companions =
        row.original.attendees?.filter((a) => a.category !== "main") ?? []
      return <span>{companions.length}</span>
    },
  },
  {
    id: "rating",
    accessorFn: (row) => row.human?.rating,
    header: "Rating",
    meta: { label: "Rating", toggleable: true },
    enableSorting: false,
    cell: ({ row }) => <RatingBadge rating={row.original.human?.rating} />,
  },
  {
    accessorKey: "submitted_at",
    header: "Submitted",
    meta: { label: "Submitted", toggleable: true, defaultHidden: true },
    cell: ({ row }) => {
      const value = row.original.submitted_at
      if (!value) return <span className="text-muted-foreground">—</span>
      return (
        <span className="text-muted-foreground">
          {new Date(value).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </span>
      )
    },
  },
  {
    accessorKey: "referral",
    header: "Referral",
    meta: { label: "Referral", toggleable: true, defaultHidden: true },
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.referral || "—"}
      </span>
    ),
  },
  ...(showReviewerDecision
    ? [
        {
          accessorKey: "review_decision",
          header: "Vote",
          meta: { label: "Vote", toggleable: true },
          cell: ({ row }) =>
            row.original.review_decision ? (
              <StatusBadge status={row.original.review_decision} />
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
        } satisfies ColumnDef<ApplicationPublic>,
      ]
    : []),
  ...customColumns,
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    meta: { toggleable: false, sticky: "right" },
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

function ApplicationsTableContent({
  customColumns,
}: {
  customColumns: ColumnDef<ApplicationPublic>[]
}) {
  const { selectedPopupId } = useWorkspace()
  const { isOperatorOrAbove } = useAuth()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const navigate = useNavigate()
  const searchParams = Route.useSearch()
  const { search, pagination, setSearch, setPagination } = useTableSearchParams(
    searchParams,
    "/applications",
  )
  const statusFilter = searchParams.status
  const reviewerId = searchParams.reviewerId

  const setStatusFilter = useCallback(
    (value: ApplicationStatus | undefined) => {
      navigate({
        to: "/applications",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          status: value,
          page: 0,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  const setReviewerFilter = useCallback(
    (value: string | undefined) => {
      navigate({
        to: "/applications",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          reviewerId: value,
          page: 0,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  const { data: applications } = useQuery({
    ...getApplicationsQueryOptions(
      selectedPopupId,
      pagination.pageIndex,
      pagination.pageSize,
      search,
      statusFilter,
      reviewerId,
    ),
    placeholderData: keepPreviousData,
  })

  const { data: popupReviewers } = useQuery({
    queryKey: ["popup-reviewers", selectedPopupId],
    queryFn: () =>
      PopupReviewersService.listReviewers({ popupId: selectedPopupId! }),
    enabled: !!selectedPopupId,
  })

  const { data: approvalStrategy } = useQuery({
    queryKey: ["approval-strategy", selectedPopupId],
    queryFn: () =>
      ApprovalStrategiesService.getApprovalStrategy({
        popupId: selectedPopupId!,
      }),
    enabled: !!selectedPopupId,
    retry: false,
  })

  const { data: popup } = useQuery({
    queryKey: ["popups", selectedPopupId],
    queryFn: () => PopupsService.getPopup({ popupId: selectedPopupId! }),
    enabled: !!selectedPopupId,
  })

  useEffect(() => {
    if (
      popup?.requires_application_fee === false &&
      statusFilter === "pending_fee"
    ) {
      setStatusFilter(undefined)
    }
  }, [popup?.requires_application_fee, setStatusFilter, statusFilter])

  const reviewers = popupReviewers?.results ?? []

  useEffect(() => {
    if (!reviewerId) return
    if (!selectedPopupId) {
      setReviewerFilter(undefined)
      return
    }
    if (
      popupReviewers &&
      !reviewers.some((reviewer) => reviewer.user_id === reviewerId)
    ) {
      setReviewerFilter(undefined)
    }
  }, [
    popupReviewers,
    reviewerId,
    reviewers,
    selectedPopupId,
    setReviewerFilter,
  ])

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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["applications"] })
      if (selectedPopupId) {
        queryClient.invalidateQueries({
          queryKey: ["dashboard", "stats", selectedPopupId],
        })
      }
    },
  })

  const isWeightedVoting = approvalStrategy?.strategy_type === "weighted"
  const columns = getColumns(isWeightedVoting, !!reviewerId, customColumns)
  const canBulkReview = isOperatorOrAbove && !isWeightedVoting

  if (!applications) return <Skeleton className="h-64 w-full" />

  return (
    <DataTable
      columns={columns}
      data={applications.results}
      tableId="applications"
      searchPlaceholder="Search by name or email..."
      hiddenOnMobile={[
        "attendees",
        "rating",
        "comments",
        "submitted_at",
        "referral",
      ]}
      searchValue={search}
      onSearchChange={setSearch}
      onRowClick={(application) =>
        navigate({
          to: "/applications/$id",
          params: { id: application.id },
        })
      }
      filterBar={
        <div className="flex flex-wrap items-center gap-2">
          <StatusDropdownFilter
            popupId={selectedPopupId}
            requiresApplicationFee={popup?.requires_application_fee}
            selected={statusFilter}
            onSelect={setStatusFilter}
          />
          {selectedPopupId ? (
            <ReviewerDropdownFilter
              reviewers={reviewers}
              selected={reviewerId}
              onSelect={setReviewerFilter}
              disabled={reviewers.length === 0}
            />
          ) : null}
        </div>
      }
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
            description="Applications will appear here once people apply to your gathering."
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
  const { isOperatorOrAbove, isSuperadmin } = useAuth()
  const { isContextReady, selectedPopupId } = useWorkspace()
  const [isExporting, setIsExporting] = useState(false)
  const [view, setView] = useState<ApplicationsView>(readStoredApplicationsView)

  const handleViewChange = useCallback((next: ApplicationsView) => {
    setView(next)
    localStorage.setItem(APPLICATIONS_VIEW_STORAGE_KEY, next)
  }, [])

  const { data: formSchema } = useQuery({
    queryKey: ["form-fields-schema", selectedPopupId],
    queryFn: async () => {
      const result = await FormFieldsService.getApplicationSchema({
        popupId: selectedPopupId!,
      })
      return result as unknown as ApplicationSchema
    },
    enabled: !!selectedPopupId,
  })

  const customColumns = useMemo(
    () => buildCustomFieldColumns(formSchema),
    [formSchema],
  )

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

      const baseColumns = [
        { key: "human.email", label: "Email" },
        { key: "human.first_name", label: "First Name" },
        { key: "human.last_name", label: "Last Name" },
        { key: "status", label: "Status" },
        { key: "referral", label: "Referral" },
        { key: "human.telegram", label: "Telegram" },
        { key: "human.gender", label: "Gender" },
        { key: "human.age", label: "Age Range" },
        { key: "human.residence", label: "Residence" },
      ]

      // Build custom columns from the ACTUAL data keys across all
      // applications, not from the current schema. Field names are
      // immutable identifiers — but if a field was renamed in the
      // past, old applications still reference the previous key.
      // Using data keys guarantees every value is exported.
      const schemaLookup = formSchema?.custom_fields ?? {}
      const seenKeys = new Set<string>()
      for (const r of results) {
        const cf = (r as Record<string, unknown>).custom_fields as
          | Record<string, unknown>
          | undefined
        if (cf) {
          for (const k of Object.keys(cf)) seenKeys.add(k)
        }
      }

      // Try to match each data key to the current schema for label
      // and position; fall back to a formatted version of the key.
      const customColumns = [...seenKeys]
        .map((name) => {
          const schemaDef = schemaLookup[name] as
            | { label?: string; position?: number }
            | undefined
          return {
            key: `custom_fields.${name}`,
            label:
              schemaDef?.label ??
              name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            position: schemaDef?.position ?? Number.MAX_SAFE_INTEGER,
          }
        })
        .sort((a, b) => a.position - b.position)
        .map(({ key, label }) => ({ key, label }))

      exportToCsv(
        "applications",
        results as unknown as Record<string, unknown>[],
        [...baseColumns, ...customColumns],
      )
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-6",
        view === "wide" &&
          isContextReady &&
          "relative left-1/2 w-[calc(100vw-18rem)] -translate-x-1/2",
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Applications</h1>
          <p className="text-muted-foreground">
            Review and manage registration applications
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isContextReady && (
            <ApplicationsViewSwitcher
              view={view}
              onViewChange={handleViewChange}
            />
          )}
          {isContextReady && isOperatorOrAbove && (
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
            <ApplicationsTableContent customColumns={customColumns} />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
