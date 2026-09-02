import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { AlertCircle, Download, Users, X } from "lucide-react"
import { Suspense, useCallback, useMemo, useState } from "react"

import { type HumanPublic, type HumanRating, HumansService } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import {
  FilterBuilder,
  type FilterCondition,
  type FilterFieldDef,
  type FilterMatch,
  FULL_TEXT_OPS,
  isCompleteCondition,
  sanitizeFilterConditions,
} from "@/components/Common/FilterBuilder"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import {
  type TableSearchParams,
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import { exportToCsv, fetchAllPages } from "@/lib/export"
import {
  HUMAN_APPLICATION_FILTER,
  type HumansApplicationFilter,
} from "@/routes/_layout/humans/navigation"

const VALID_APPLICATION_FILTERS = new Set<HumansApplicationFilter>([
  HUMAN_APPLICATION_FILTER.ALL,
  HUMAN_APPLICATION_FILTER.INCOMPLETE,
])

const HUMAN_RATING_OPTIONS: { value: HumanRating; label: string }[] = [
  { value: "unrated", label: "No rating" },
  { value: "red_flag", label: "🔴 Red Flag" },
  { value: "orange_flag", label: "🟠 Orange Flag" },
  { value: "green_flag", label: "🟢 Green Flag" },
  { value: "star", label: "⭐ Star" },
]

const HUMAN_EMAIL_OPS = ["eq", "neq", "contains", "not_contains"]
const HUMAN_ENRICHED_OPS = ["contains", "not_contains", "is_empty", "not_empty"]

const HUMAN_FILTER_FIELDS: FilterFieldDef[] = [
  { key: "email", label: "Email", kind: "text", ops: HUMAN_EMAIL_OPS },
  { key: "first_name", label: "First name", kind: "text", ops: FULL_TEXT_OPS },
  { key: "last_name", label: "Last name", kind: "text", ops: FULL_TEXT_OPS },
  { key: "telegram", label: "Telegram", kind: "text", ops: FULL_TEXT_OPS },
  { key: "gender", label: "Gender", kind: "text", ops: FULL_TEXT_OPS },
  { key: "age", label: "Age", kind: "text", ops: FULL_TEXT_OPS },
  { key: "residence", label: "Residence", kind: "text", ops: FULL_TEXT_OPS },
  {
    key: "rating",
    label: "Rating",
    kind: "select",
    ops: ["eq", "neq"],
    options: HUMAN_RATING_OPTIONS,
  },
  {
    key: "enriched_profile",
    label: "Rich profile",
    kind: "text",
    ops: HUMAN_ENRICHED_OPS,
  },
]

export type HumansSearchParams = TableSearchParams & {
  applicationFilter: HumansApplicationFilter
  match?: FilterMatch
  filters?: FilterCondition[]
}

function getHumansQueryOptions(
  popupId: string | null,
  page: number,
  pageSize: number,
  search: string | undefined,
  applicationFilter: HumansApplicationFilter,
  filtersJson: string | undefined,
) {
  const isIncomplete = applicationFilter === HUMAN_APPLICATION_FILTER.INCOMPLETE
  return {
    queryFn: () =>
      HumansService.listHumans({
        skip: page * pageSize,
        limit: pageSize,
        search: search || undefined,
        incompleteApplication: isIncomplete ? true : undefined,
        popupId: isIncomplete ? (popupId ?? undefined) : undefined,
        filters: filtersJson,
      }),
    queryKey: [
      "humans",
      { popupId, page, pageSize, search, applicationFilter, filtersJson },
    ],
  }
}

// Mirrors the table's data: profile scalars plus the rating badge value.
function flattenHumansForCsv(humans: HumanPublic[]) {
  return humans.map((human) => ({
    name: `${human.first_name ?? ""} ${human.last_name ?? ""}`.trim(),
    email: human.email,
    telegram: human.telegram ?? "",
    gender: human.gender ?? "",
    age: human.age ?? "",
    residence: human.residence ?? "",
    rating: human.rating ?? "unrated",
  }))
}

const HUMAN_CSV_COLUMNS = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "telegram", label: "Telegram" },
  { key: "gender", label: "Gender" },
  { key: "age", label: "Age" },
  { key: "residence", label: "Residence" },
  { key: "rating", label: "Rating" },
]

export const Route = createFileRoute("/_layout/humans/")({
  component: Humans,
  validateSearch: (raw): HumansSearchParams => {
    const filters = sanitizeFilterConditions(raw.filters)
    return {
      ...validateTableSearch(raw),
      applicationFilter:
        typeof raw.applicationFilter === "string" &&
        VALID_APPLICATION_FILTERS.has(
          raw.applicationFilter as HumansApplicationFilter,
        )
          ? (raw.applicationFilter as HumansApplicationFilter)
          : HUMAN_APPLICATION_FILTER.ALL,
      ...(raw.match === "any" && filters.length
        ? { match: "any" as const }
        : {}),
      ...(filters.length ? { filters } : {}),
    }
  },
  head: () => ({
    meta: [{ title: "Humans - EdgeOS" }],
  }),
})

function useHumansFilterParams() {
  const searchParams = Route.useSearch()
  const filterMatch = searchParams.match ?? "all"
  const filterConditions = useMemo(
    () => searchParams.filters ?? [],
    [searchParams.filters],
  )
  const filtersJson = useMemo(() => {
    const complete = filterConditions.filter(isCompleteCondition)
    return complete.length
      ? JSON.stringify({ match: filterMatch, conditions: complete })
      : undefined
  }, [filterConditions, filterMatch])
  return { filterMatch, filterConditions, filtersJson }
}

function HumansApplicationFilterSelect({
  value,
  onValueChange,
}: {
  value: HumansApplicationFilter
  onValueChange: (value: HumansApplicationFilter) => void
}) {
  return (
    <Select
      value={value}
      onValueChange={(nextValue) =>
        onValueChange(nextValue as HumansApplicationFilter)
      }
    >
      <SelectTrigger className="w-[240px]">
        <SelectValue placeholder="Filter humans" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={HUMAN_APPLICATION_FILTER.ALL}>All humans</SelectItem>
        <SelectItem value={HUMAN_APPLICATION_FILTER.INCOMPLETE}>
          Incomplete application
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

const columns: ColumnDef<HumanPublic>[] = [
  {
    id: "name",
    header: ({ column }) => <SortableHeader label="Name" column={column} />,
    accessorFn: (row) =>
      `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
    cell: ({ row }) => {
      const firstName = row.original.first_name ?? ""
      const lastName = row.original.last_name ?? ""
      const fullName = `${firstName} ${lastName}`.trim()
      return <span className="text-muted-foreground">{fullName || "—"}</span>
    },
  },
  {
    accessorKey: "email",
    header: ({ column }) => <SortableHeader label="Email" column={column} />,
    cell: ({ row }) => (
      <span className="font-medium">{row.original.email}</span>
    ),
  },
  {
    accessorKey: "rating",
    header: "Rating",
    cell: ({ row }) => (
      <StatusBadge status={row.original.rating ?? "unrated"} />
    ),
  },
]

function HumansTableContent() {
  const navigate = useNavigate({ from: "/humans/" })
  const searchParams = Route.useSearch()
  const { selectedPopupId } = useWorkspace()
  const { search, pagination, setSearch, setPagination } = useTableSearchParams(
    searchParams,
    "/humans",
  )
  const { filterMatch, filterConditions, filtersJson } = useHumansFilterParams()
  const applicationFilter =
    searchParams.applicationFilter ?? HUMAN_APPLICATION_FILTER.ALL
  const requiresPopupForFilter =
    applicationFilter === HUMAN_APPLICATION_FILTER.INCOMPLETE &&
    !selectedPopupId

  const setFilters = useCallback(
    (match: FilterMatch, conditions: FilterCondition[]) => {
      navigate({
        to: "/humans",
        search: (prev) => ({
          ...prev,
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

  const hasActiveView = Boolean(filterConditions.length || search)

  const clearView = useCallback(() => {
    navigate({
      to: "/humans",
      search: (prev) => ({
        ...prev,
        match: undefined,
        filters: undefined,
        search: undefined,
        page: 0,
      }),
      replace: true,
    })
  }, [navigate])

  const setApplicationFilter = (value: HumansApplicationFilter) => {
    navigate({
      to: "/humans",
      search: (prev) => ({
        ...prev,
        applicationFilter: value,
        page: 0,
      }),
      replace: true,
    })
  }

  const { data: humans } = useQuery({
    ...getHumansQueryOptions(
      selectedPopupId,
      pagination.pageIndex,
      pagination.pageSize,
      search,
      applicationFilter,
      filtersJson,
    ),
    enabled: !requiresPopupForFilter,
    placeholderData: keepPreviousData,
  })

  if (requiresPopupForFilter) {
    return (
      <div className="flex flex-col gap-4">
        <WorkspaceAlert resource="humans with incomplete applications" />
      </div>
    )
  }

  if (!humans) return <Skeleton className="h-64 w-full" />

  return (
    <DataTable
      columns={columns}
      data={humans.results}
      searchPlaceholder="Search by name or email..."
      hiddenOnMobile={["rating"]}
      searchValue={search}
      onSearchChange={setSearch}
      onRowClick={(human) =>
        navigate({ to: "/humans/$id", params: { id: human.id } })
      }
      filterBar={
        <div className="flex flex-wrap items-center gap-2">
          <HumansApplicationFilterSelect
            value={applicationFilter}
            onValueChange={setApplicationFilter}
          />
          <FilterBuilder
            fields={HUMAN_FILTER_FIELDS}
            match={filterMatch}
            conditions={filterConditions}
            onChange={setFilters}
            emptyMessage="No filters applied. Add a filter to narrow down humans."
          />
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
      }
      serverPagination={{
        total: humans.paging.total,
        pagination: pagination,
        onPaginationChange: setPagination,
      }}
      emptyState={
        !search && !filterConditions.length ? (
          <EmptyState
            icon={Users}
            title="No humans yet"
            description="Humans will appear here once end-users register through your gatherings."
          />
        ) : undefined
      }
    />
  )
}

function HumansTable() {
  return (
    <QueryErrorBoundary>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <HumansTableContent />
      </Suspense>
    </QueryErrorBoundary>
  )
}

function Humans() {
  const { needsTenantSelection, isContextReady, selectedPopupId } =
    useWorkspace()
  const searchParams = Route.useSearch()
  const { filtersJson } = useHumansFilterParams()
  const [isExporting, setIsExporting] = useState(false)

  const search = searchParams.search || undefined
  const applicationFilter =
    searchParams.applicationFilter ?? HUMAN_APPLICATION_FILTER.ALL
  const isIncomplete = applicationFilter === HUMAN_APPLICATION_FILTER.INCOMPLETE

  // Export what the table shows: the same search and filter conditions drive
  // the fetch, just without pagination.
  const isExportFiltered = Boolean(search || filtersJson || isIncomplete)
  const handleExport = async () => {
    if (isIncomplete && !selectedPopupId) return
    setIsExporting(true)
    try {
      const results = await fetchAllPages((skip, limit) =>
        HumansService.listHumans({
          skip,
          limit,
          search,
          incompleteApplication: isIncomplete ? true : undefined,
          popupId: isIncomplete ? (selectedPopupId ?? undefined) : undefined,
          filters: filtersJson,
        }),
      )
      exportToCsv(
        isExportFiltered ? "humans-filtered" : "humans",
        flattenHumansForCsv(results),
        HUMAN_CSV_COLUMNS,
      )
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {needsTenantSelection && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Select an organization</AlertTitle>
          <AlertDescription>
            Please select an organization from the sidebar to view humans.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Humans</h1>
          <p className="text-muted-foreground">
            End-users who interact with your gatherings
          </p>
        </div>
        {isContextReady && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={isExporting}
              title={
                isExportFiltered
                  ? "Exports the humans matching the current filters"
                  : "Exports all humans"
              }
            >
              <Download className="mr-2 h-4 w-4" />
              {isExporting
                ? "Exporting..."
                : isExportFiltered
                  ? "Export filtered CSV"
                  : "Export CSV"}
            </Button>
          </div>
        )}
      </div>
      {!needsTenantSelection && <HumansTable />}
    </div>
  )
}
