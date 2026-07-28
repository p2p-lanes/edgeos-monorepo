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
  Flag,
  ListChecks,
  MessageSquare,
  Plus,
  Search,
  SkipForward,
  Star,
  ThumbsDown,
  ThumbsUp,
  Users,
  X,
} from "lucide-react"
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import {
  type ApiError,
  type ApplicationPublic,
  type ApplicationReviewerVote,
  ApplicationReviewsService,
  type ApplicationStatus,
  ApplicationsService,
  ApprovalStrategiesService,
  FormFieldsService,
  type HumanRating,
  PopupReviewersService,
  PopupsService,
  type ReviewDecision,
} from "@/client"
import {
  ApplicationFilterBuilder,
  type CustomFilterField,
  type FilterCondition,
  type FilterMatch,
  isCompleteCondition,
  sanitizeFilterConditions,
} from "@/components/applications/ApplicationFilterBuilder"
import { ApplicationsGroupedView } from "@/components/applications/ApplicationsGroupedView"
import {
  type ApplicationsView,
  ApplicationsViewSwitcher,
} from "@/components/applications/ApplicationsViewSwitcher"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { SavedViewsMenu } from "@/components/Common/SavedViewsMenu"
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
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
  base_fields?: Record<
    string,
    {
      type?: string
      options?: string[]
      [key: string]: unknown
    }
  >
  custom_fields: Record<
    string,
    {
      label: string
      short_label?: string
      type?: string
      position?: number
      options?: string[]
      config?: { is_checkbox?: boolean }
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
  if (type === "image_upload") return "Uploaded"
  if (type === "date" && typeof value === "string") {
    return new Date(value).toLocaleDateString()
  }
  if (Array.isArray(value)) return value.join(", ")
  if (typeof value === "object") return "—"
  return String(value)
}

// Display-only fields never collect a response, so they have no data to
// surface as a column. rich_text collects a boolean only in checkbox mode.
function isDisplayOnlyField(def: {
  type?: string
  config?: { is_checkbox?: boolean }
}): boolean {
  return def.type === "rich_text" && !def.config?.is_checkbox
}

// Build one toggleable, hidden-by-default column per custom form-builder
// field so operators can surface any dynamic attribute from the toggle
// columns menu. Ordered by the schema position, matching the form builder.
function buildCustomFieldColumns(
  formSchema?: ApplicationSchema,
): ColumnDef<ApplicationPublic>[] {
  const customFields = formSchema?.custom_fields ?? {}
  return Object.entries(customFields)
    .filter(([, def]) => !isDisplayOnlyField(def))
    .sort(
      ([, a], [, b]) =>
        (a.position ?? Number.MAX_SAFE_INTEGER) -
        (b.position ?? Number.MAX_SAFE_INTEGER),
    )
    .map(([name, def]) => {
      const label = def.short_label || def.label || name
      // When a short label names the column, hover still reveals the
      // full question.
      const title = def.short_label ? def.label || label : label
      return {
        id: `custom_${name}`,
        accessorFn: (row) => row.custom_fields?.[name],
        header: () => (
          <span className="block max-w-48 truncate" title={title}>
            {label}
          </span>
        ),
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

// Field types whose answers come from a closed option list. All of them
// store the selected option string(s), so filters can match exact values.
const OPTION_FIELD_TYPES = new Set([
  "select",
  "select_cards",
  "radio",
  "multiselect",
  "multiselect_detailed",
])

// Custom form fields become filterable attributes; select-like fields keep
// their options so the value input can offer them.
function buildCustomFilterFields(
  formSchema?: ApplicationSchema,
): CustomFilterField[] {
  const customFields = formSchema?.custom_fields ?? {}
  return Object.entries(customFields)
    .filter(([, def]) => !isDisplayOnlyField(def))
    .sort(
      ([, a], [, b]) =>
        (a.position ?? Number.MAX_SAFE_INTEGER) -
        (b.position ?? Number.MAX_SAFE_INTEGER),
    )
    .map(([name, def]) => ({
      name,
      label: def.short_label || def.label || name,
      options: def.options,
      isSelect:
        OPTION_FIELD_TYPES.has(def.type ?? "") &&
        (def.options?.length ?? 0) > 0,
    }))
}

// Base fields with fixed options (e.g. gender configured as a select in the
// form builder) feed the matching filters a value picker.
function buildBaseFieldOptions(
  formSchema?: ApplicationSchema,
): Record<string, string[]> {
  const baseFields = formSchema?.base_fields ?? {}
  return Object.fromEntries(
    Object.entries(baseFields)
      .filter(([, def]) => (def.options?.length ?? 0) > 0)
      .map(([name, def]) => [name, def.options as string[]]),
  )
}

/** Custom form-builder field usable as a grouping attribute. */
interface GroupByField {
  key: string
  label: string
  options?: string[]
}

const FIXED_GROUP_BY_OPTIONS: { value: string; label: string }[] = [
  { value: "status", label: "Status" },
  { value: "scholarship_status", label: "Scholarship status" },
  { value: "gender", label: "Gender" },
  { value: "age", label: "Age" },
]

const VALID_GROUP_BY_FIELDS = new Set(
  FIXED_GROUP_BY_OPTIONS.map((option) => option.value),
)

// Only closed-vocabulary custom fields group well; free-text fields have
// too high a cardinality to produce useful buckets.
function buildGroupByCustomFields(
  formSchema?: ApplicationSchema,
): GroupByField[] {
  const customFields = formSchema?.custom_fields ?? {}
  return Object.entries(customFields)
    .filter(
      ([, def]) =>
        OPTION_FIELD_TYPES.has(def.type ?? "") || def.type === "boolean",
    )
    .sort(
      ([, a], [, b]) =>
        (a.position ?? Number.MAX_SAFE_INTEGER) -
        (b.position ?? Number.MAX_SAFE_INTEGER),
    )
    .map(([name, def]) => ({
      key: `custom.${name}`,
      label: def.short_label || def.label || name,
      options: def.options,
    }))
}

function GroupBySelect({
  value,
  onChange,
  customFields,
}: {
  value?: string
  onChange: (value: string | undefined) => void
  customFields: GroupByField[]
}) {
  const activeLabel =
    FIXED_GROUP_BY_OPTIONS.find((option) => option.value === value)?.label ??
    customFields.find((field) => field.key === value)?.label
  return (
    <Select
      value={value ?? "none"}
      onValueChange={(next) => onChange(next === "none" ? undefined : next)}
    >
      <SelectTrigger className="h-9 w-[190px]">
        <SelectValue>
          {value ? `Group: ${activeLabel ?? value}` : "Group by"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No grouping</SelectItem>
        {FIXED_GROUP_BY_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
        {customFields.length > 0 && (
          <SelectGroup>
            <SelectLabel>Form fields</SelectLabel>
            {customFields.map((field) => (
              <SelectItem key={field.key} value={field.key}>
                {field.label}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  )
}

// Standalone debounced search box for the grouped view, where no single
// DataTable owns the toolbar. Mirrors the DataTable search behavior.
function DebouncedSearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  const [local, setLocal] = useState(value)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    setLocal(value)
  }, [value])

  const handleChange = (next: string) => {
    setLocal(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onChange(next), 300)
  }

  return (
    <div className="relative w-full min-w-0 sm:max-w-xs">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        className="pl-9 pr-8"
      />
      {local && (
        <button
          type="button"
          onClick={() => handleChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

function getApplicationsQueryOptions(
  popupId: string | null,
  page: number,
  pageSize: number,
  search?: string,
  filters?: string,
) {
  return {
    queryFn: () =>
      ApplicationsService.listApplications({
        skip: page * pageSize,
        limit: pageSize,
        popupId: popupId || undefined,
        search: search || undefined,
        filters: filters || undefined,
      }),
    queryKey: ["applications", popupId, { page, pageSize, search, filters }],
  }
}

const VALID_STATUSES: Set<string> = new Set([
  "draft",
  "pending_fee",
  "in review",
  "accepted",
  "rejected",
])

type ApplicationsSearchParams = TableSearchParams & {
  match?: FilterMatch
  filters?: FilterCondition[]
  groupBy?: string
}

export const Route = createFileRoute("/_layout/applications/")({
  component: Applications,
  validateSearch: (raw: Record<string, unknown>): ApplicationsSearchParams => {
    const filters = sanitizeFilterConditions(raw.filters)
    // Legacy ?status= and ?reviewerId= links fold into the filter conditions.
    if (
      typeof raw.status === "string" &&
      VALID_STATUSES.has(raw.status) &&
      !filters.some((condition) => condition.field === "status")
    ) {
      filters.push({ field: "status", op: "eq", value: raw.status })
    }
    if (
      typeof raw.reviewerId === "string" &&
      raw.reviewerId &&
      !filters.some((condition) => condition.field === "reviewed_by")
    ) {
      filters.push({ field: "reviewed_by", op: "eq", value: raw.reviewerId })
    }
    const groupBy =
      typeof raw.groupBy === "string" &&
      (VALID_GROUP_BY_FIELDS.has(raw.groupBy) ||
        raw.groupBy.startsWith("custom."))
        ? raw.groupBy
        : undefined
    return {
      ...validateTableSearch(raw),
      ...(raw.match === "any" && filters.length
        ? { match: "any" as const }
        : {}),
      ...(filters.length ? { filters } : {}),
      ...(groupBy ? { groupBy } : {}),
    }
  },
  head: () => ({
    meta: [{ title: "Applications - EdgeOS" }],
  }),
})

// Single source for the filter-related search params, shared by the table
// and the CSV export so both always query the same subset.
function useApplicationsFilterParams() {
  const searchParams = Route.useSearch()
  const filterMatch = searchParams.match ?? "all"
  const filterConditions = useMemo(
    () => searchParams.filters ?? [],
    [searchParams.filters],
  )
  // Rows with a missing value stay in the UI but never reach the request.
  const filtersJson = useMemo(() => {
    const complete = filterConditions.filter(isCompleteCondition)
    return complete.length
      ? JSON.stringify({ match: filterMatch, conditions: complete })
      : undefined
  }, [filterConditions, filterMatch])
  return {
    search: searchParams.search ?? "",
    filterMatch,
    filterConditions,
    filtersJson,
  }
}

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
  red_flag: { label: "Red flag", className: "text-destructive", icon: "flag" },
  orange_flag: {
    label: "Orange flag",
    className: "text-warning",
    icon: "flag",
  },
  green_flag: {
    label: "Green flag",
    className: "text-success",
    icon: "flag",
  },
  // The star keeps a fixed gold — it is an iconographic accent, not a UI state.
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
    ? "bg-success"
    : "bg-destructive"
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

function CommentsCell({
  applicationId,
  count,
}: {
  applicationId: string
  count: number
}) {
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ["application-comments", applicationId],
    queryFn: () =>
      ApplicationsService.listApplicationComments({ applicationId }),
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
      // Row click opens the application; the human profile stays reachable
      // from the detail hero.
      <span className="font-medium">
        {row.original.human?.first_name} {row.original.human?.last_name}
      </span>
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
    cell: ({ row }) => (
      <div className="flex items-center gap-1.5">
        <StatusBadge status={row.original.status} />
        {row.original.skipped_by_me && (
          <span
            title={
              row.original.my_skip_reason
                ? `You skipped this application: ${row.original.my_skip_reason}`
                : "You skipped this application"
            }
            className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground"
          >
            <SkipForward className="h-3 w-3" />
            Skipped
          </span>
        )}
      </div>
    ),
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
        applicationId={row.original.id}
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
  customFilterFields,
  baseFieldOptions,
  groupByCustomFields,
  isSchemaLoaded,
}: {
  customColumns: ColumnDef<ApplicationPublic>[]
  customFilterFields: CustomFilterField[]
  baseFieldOptions: Record<string, string[]>
  groupByCustomFields: GroupByField[]
  isSchemaLoaded: boolean
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
  const { filterMatch, filterConditions, filtersJson } =
    useApplicationsFilterParams()

  // Derives the single concrete value a filter field is pinned to, or
  // "custom" for anything richer; used to activate the reviewer vote column.
  const deriveQuickFilter = useCallback(
    (field: string): string | undefined => {
      const matching = filterConditions.filter(
        (condition) => condition.field === field,
      )
      if (matching.length === 0) return undefined
      const [only] = matching
      if (
        matching.length === 1 &&
        only.op === "eq" &&
        (filterMatch === "all" || filterConditions.length === 1)
      ) {
        return typeof only.value === "string" ? only.value : "custom"
      }
      return "custom"
    },
    [filterConditions, filterMatch],
  )
  const reviewerFilter = deriveQuickFilter("reviewed_by")

  const setFilters = useCallback(
    (match: FilterMatch, conditions: FilterCondition[]) => {
      navigate({
        to: "/applications",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          // Scrub the legacy params so validateSearch cannot fold them back
          // into resurrected conditions after the user edits the filters.
          status: undefined,
          reviewerId: undefined,
          match:
            match === "any" && conditions.length ? ("any" as const) : undefined,
          filters: conditions.length ? conditions : undefined,
          page: 0,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  const hasActiveView = Boolean(
    filterConditions.length ||
      search ||
      searchParams.groupBy ||
      searchParams.sortBy,
  )

  // Back to the pristine list: filters, search, grouping, sorting and the
  // legacy params all reset in one navigation.
  const clearView = useCallback(() => {
    navigate({
      to: "/applications",
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        status: undefined,
        reviewerId: undefined,
        match: undefined,
        filters: undefined,
        groupBy: undefined,
        search: undefined,
        sortBy: undefined,
        sortOrder: undefined,
        page: 0,
      }),
      replace: true,
    })
  }, [navigate])

  const setGroupBy = useCallback(
    (value: string | undefined) => {
      navigate({
        to: "/applications",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          groupBy: value,
          page: 0,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  // The saved-view config only captures explicit choices; defaults stay out
  // so applying a view produces a minimal URL.
  const savedViewConfig = useMemo(() => {
    const config: Record<string, unknown> = {}
    if (searchParams.match === "any" && filterConditions.length) {
      config.match = "any"
    }
    if (filterConditions.length) config.filters = filterConditions
    if (searchParams.groupBy) config.groupBy = searchParams.groupBy
    if (searchParams.sortBy) {
      config.sortBy = searchParams.sortBy
      config.sortOrder = searchParams.sortOrder
    }
    return config
  }, [
    searchParams.match,
    searchParams.groupBy,
    searchParams.sortBy,
    searchParams.sortOrder,
    filterConditions,
  ])

  // Saved-view configs are team-authored server data: revalidate every field
  // with the same rules validateSearch applies before touching the URL.
  const applySavedView = useCallback(
    (config: Record<string, unknown>) => {
      const filters = sanitizeFilterConditions(config.filters)
      const groupByValue =
        typeof config.groupBy === "string" &&
        (VALID_GROUP_BY_FIELDS.has(config.groupBy) ||
          config.groupBy.startsWith("custom."))
          ? config.groupBy
          : undefined
      const sortOrder: "asc" | "desc" | undefined =
        config.sortOrder === "asc" || config.sortOrder === "desc"
          ? config.sortOrder
          : undefined
      navigate({
        to: "/applications",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          status: undefined,
          reviewerId: undefined,
          page: 0,
          match:
            config.match === "any" && filters.length
              ? ("any" as const)
              : undefined,
          filters: filters.length ? filters : undefined,
          groupBy: groupByValue,
          sortBy:
            typeof config.sortBy === "string" && config.sortBy
              ? config.sortBy
              : undefined,
          sortOrder,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  // Grouping needs a selected popup; the counts endpoint is popup-scoped.
  const groupBy =
    selectedPopupId && searchParams.groupBy ? searchParams.groupBy : undefined

  // Drop custom group fields that no longer exist in the schema (e.g. after
  // switching gatherings).
  useEffect(() => {
    if (!isSchemaLoaded || !groupBy?.startsWith("custom.")) return
    if (!groupByCustomFields.some((field) => field.key === groupBy)) {
      setGroupBy(undefined)
    }
  }, [isSchemaLoaded, groupBy, groupByCustomFields, setGroupBy])

  const groupValueOrder = useMemo(() => {
    if (groupBy === "status") {
      return APPLICATION_STATUS_OPTIONS.map((option) => option.value)
    }
    if (groupBy?.startsWith("custom.")) {
      return groupByCustomFields.find((field) => field.key === groupBy)?.options
    }
    return undefined
  }, [groupBy, groupByCustomFields])

  const { data: applications } = useQuery({
    ...getApplicationsQueryOptions(
      selectedPopupId,
      pagination.pageIndex,
      pagination.pageSize,
      search,
      filtersJson,
    ),
    placeholderData: keepPreviousData,
    // The grouped view fetches its own per-group pages instead.
    enabled: !groupBy,
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
    if (popup?.requires_application_fee !== false) return
    const hasPendingFee = filterConditions.some(
      (condition) =>
        condition.field === "status" && condition.value === "pending_fee",
    )
    if (hasPendingFee) {
      setFilters(
        filterMatch,
        filterConditions.filter(
          (condition) =>
            !(
              condition.field === "status" && condition.value === "pending_fee"
            ),
        ),
      )
    }
  }, [
    popup?.requires_application_fee,
    filterConditions,
    filterMatch,
    setFilters,
  ])

  const reviewers = popupReviewers?.results ?? []

  // Drop reviewer conditions that reference reviewers outside the current
  // popup (e.g. after switching gatherings).
  useEffect(() => {
    if (!popupReviewers) return
    const isInvalid = (condition: FilterCondition) =>
      condition.field === "reviewed_by" &&
      (!selectedPopupId ||
        !reviewers.some((reviewer) => reviewer.user_id === condition.value))
    if (filterConditions.some(isInvalid)) {
      setFilters(
        filterMatch,
        filterConditions.filter((condition) => !isInvalid(condition)),
      )
    }
  }, [
    popupReviewers,
    reviewers,
    selectedPopupId,
    filterConditions,
    filterMatch,
    setFilters,
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
  const columns = getColumns(
    isWeightedVoting,
    !!reviewerFilter && reviewerFilter !== "custom",
    customColumns,
  )
  const canBulkReview = isOperatorOrAbove && !isWeightedVoting

  const hiddenOnMobile = [
    "attendees",
    "rating",
    "comments",
    "submitted_at",
    "referral",
  ]

  const filterBar = (
    <div className="flex flex-wrap items-center gap-2">
      <ApplicationFilterBuilder
        statusOptions={
          popup?.requires_application_fee === false
            ? APPLICATION_STATUS_OPTIONS.filter(
                (opt) => opt.value !== "pending_fee",
              )
            : APPLICATION_STATUS_OPTIONS
        }
        customFields={customFilterFields}
        baseFieldOptions={baseFieldOptions}
        reviewerOptions={reviewers.map((reviewer) => ({
          value: reviewer.user_id,
          label:
            reviewer.user_full_name ?? reviewer.user_email ?? reviewer.user_id,
        }))}
        match={filterMatch}
        conditions={filterConditions}
        onChange={setFilters}
      />
      <GroupBySelect
        value={searchParams.groupBy}
        onChange={setGroupBy}
        customFields={groupByCustomFields}
      />
      {selectedPopupId && (
        <SavedViewsMenu
          popupId={selectedPopupId}
          entity="applications"
          currentConfig={savedViewConfig}
          onApply={applySavedView}
        />
      )}
      {hasActiveView && (
        <Button
          variant="ghost"
          className="h-9 text-muted-foreground"
          onClick={clearView}
        >
          <X className="h-4 w-4" />
          Clear
        </Button>
      )}
    </div>
  )

  if (groupBy && selectedPopupId) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <DebouncedSearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search by name or email..."
            />
            <div className="flex min-w-0 flex-1 items-center">{filterBar}</div>
          </div>
        </div>
        <ApplicationsGroupedView
          key={groupBy}
          popupId={selectedPopupId}
          groupBy={groupBy}
          columns={columns}
          filterMatch={filterMatch}
          filterConditions={filterConditions}
          search={search}
          valueOrder={groupValueOrder}
          hiddenOnMobile={hiddenOnMobile}
        />
      </div>
    )
  }

  if (!applications) return <Skeleton className="h-64 w-full" />

  return (
    <DataTable
      columns={columns}
      data={applications.results}
      tableId="applications"
      searchPlaceholder="Search by name or email..."
      hiddenOnMobile={hiddenOnMobile}
      searchValue={search}
      onSearchChange={setSearch}
      onRowClick={(application) =>
        navigate({
          to: "/applications/$id",
          params: { id: application.id },
        })
      }
      filterBar={filterBar}
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
  const { search, filtersJson } = useApplicationsFilterParams()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [isExporting, setIsExporting] = useState(false)
  const [view, setView] = useState<ApplicationsView>(readStoredApplicationsView)

  const handleViewChange = useCallback((next: ApplicationsView) => {
    setView(next)
    localStorage.setItem(APPLICATIONS_VIEW_STORAGE_KEY, next)
  }, [])

  const { data: formSchema } = useQuery({
    queryKey: ["form-fields", "schema", selectedPopupId],
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

  const customFilterFields = useMemo(
    () => buildCustomFilterFields(formSchema),
    [formSchema],
  )

  const baseFieldOptions = useMemo(
    () => buildBaseFieldOptions(formSchema),
    [formSchema],
  )

  const groupByCustomFields = useMemo(
    () => buildGroupByCustomFields(formSchema),
    [formSchema],
  )

  // Export what the table shows: the same search, reviewer and filter
  // conditions drive the fetch, just without pagination.
  const isExportFiltered = Boolean(search || filtersJson)
  const handleExport = async () => {
    if (!selectedPopupId) return
    setIsExporting(true)
    try {
      const results = await fetchAllPages((skip, limit) =>
        ApplicationsService.listApplications({
          skip,
          limit,
          popupId: selectedPopupId,
          search: search || undefined,
          filters: filtersJson,
        }),
      )

      if (results.length === 0) {
        showErrorToast(
          isExportFiltered
            ? "No applications match the current filters"
            : "There are no applications to export",
        )
        return
      }

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
        .filter((name) => {
          const schemaDef = schemaLookup[name]
          return !schemaDef || !isDisplayOnlyField(schemaDef)
        })
        .map((name) => {
          const schemaDef = schemaLookup[name] as
            | { label?: string; short_label?: string; position?: number }
            | undefined
          return {
            key: `custom_fields.${name}`,
            label:
              schemaDef?.short_label ||
              (schemaDef?.label ??
                name
                  .replace(/_/g, " ")
                  .replace(/\b\w/g, (c) => c.toUpperCase())),
            position: schemaDef?.position ?? Number.MAX_SAFE_INTEGER,
          }
        })
        .sort((a, b) => a.position - b.position)
        .map(({ key, label }) => ({ key, label }))

      exportToCsv(
        isExportFiltered ? "applications-filtered" : "applications",
        results as unknown as Record<string, unknown>[],
        [...baseColumns, ...customColumns],
      )
      showSuccessToast(
        `Exported ${results.length} application${results.length === 1 ? "" : "s"}`,
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
              title={
                isExportFiltered
                  ? "Exports the applications matching the current filters"
                  : "Exports all applications for this gathering"
              }
            >
              <Download className="mr-2 h-4 w-4" />
              {isExporting
                ? "Exporting..."
                : isExportFiltered
                  ? "Export filtered CSV"
                  : "Export CSV"}
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
            <ApplicationsTableContent
              customColumns={customColumns}
              customFilterFields={customFilterFields}
              baseFieldOptions={baseFieldOptions}
              groupByCustomFields={groupByCustomFields}
              isSchemaLoaded={!!formSchema}
            />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
