import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { AlertCircle, Plus, SlidersHorizontal, Users, X } from "lucide-react"
import { Suspense, useEffect, useState } from "react"

import { type HumanPublic, type HumanRating, HumansService } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import {
  HUMAN_APPLICATION_FILTER,
  type HumansApplicationFilter,
} from "@/routes/_layout/humans/navigation"

const VALID_APPLICATION_FILTERS = new Set<HumansApplicationFilter>([
  HUMAN_APPLICATION_FILTER.ALL,
  HUMAN_APPLICATION_FILTER.INCOMPLETE,
])

type HumanFieldFilters = {
  email?: string
  telegram?: string
  gender?: string
  age?: string
  residence?: string
  enrichment?: string
}

const HUMAN_FIELD_FILTER_DEFS: {
  key: keyof HumanFieldFilters
  label: string
  placeholder: string
}[] = [
  { key: "email", label: "Email", placeholder: "name@example.com" },
  { key: "telegram", label: "Telegram", placeholder: "@handle" },
  { key: "gender", label: "Gender", placeholder: "female" },
  { key: "age", label: "Age", placeholder: "30" },
  { key: "residence", label: "Residence", placeholder: "Buenos Aires" },
  {
    key: "enrichment",
    label: "Rich profile contains",
    placeholder: "AI, founder, Buenos Aires…",
  },
]

function countActiveFieldFilters(filters: HumanFieldFilters): number {
  return HUMAN_FIELD_FILTER_DEFS.filter(
    (d) => (filters[d.key] ?? "").trim() !== "",
  ).length
}

/** Sentinel for "no rating filter" — Select can't hold an empty value. */
const RATING_FILTER_ALL = "all"

const HUMAN_RATING_OPTIONS: { value: HumanRating; label: string }[] = [
  { value: "unrated", label: "No rating" },
  { value: "red_flag", label: "🔴 Red Flag" },
  { value: "orange_flag", label: "🟠 Orange Flag" },
  { value: "green_flag", label: "🟢 Green Flag" },
  { value: "star", label: "⭐ Star" },
]

/** Snapshot a value behind a debounce so typing doesn't fire a query per key. */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function getHumansQueryOptions(
  popupId: string | null,
  page: number,
  pageSize: number,
  search?: string,
  applicationFilter: HumansApplicationFilter = HUMAN_APPLICATION_FILTER.ALL,
  fieldFilters: HumanFieldFilters = {},
  rating: HumanRating | null = null,
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
        // Field filters apply to the default ("all humans") listing; the
        // incomplete-application path filters by draft status instead.
        email: fieldFilters.email?.trim() || undefined,
        telegram: fieldFilters.telegram?.trim() || undefined,
        gender: fieldFilters.gender?.trim() || undefined,
        age: fieldFilters.age?.trim() || undefined,
        residence: fieldFilters.residence?.trim() || undefined,
        rating: rating ?? undefined,
        enrichmentQuery: fieldFilters.enrichment?.trim() || undefined,
      }),
    queryKey: [
      "humans",
      {
        popupId,
        page,
        pageSize,
        search,
        applicationFilter,
        fieldFilters,
        rating,
      },
    ],
  }
}

export const Route = createFileRoute("/_layout/humans/")({
  component: Humans,
  validateSearch: (raw) => ({
    ...validateTableSearch(raw),
    applicationFilter:
      typeof raw.applicationFilter === "string" &&
      VALID_APPLICATION_FILTERS.has(
        raw.applicationFilter as HumansApplicationFilter,
      )
        ? (raw.applicationFilter as HumansApplicationFilter)
        : HUMAN_APPLICATION_FILTER.ALL,
  }),
  head: () => ({
    meta: [{ title: "Humans - EdgeOS" }],
  }),
})

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

function HumansRatingFilterSelect({
  value,
  onValueChange,
}: {
  value: HumanRating | null
  onValueChange: (value: HumanRating | null) => void
}) {
  return (
    <Select
      value={value ?? RATING_FILTER_ALL}
      onValueChange={(next) =>
        onValueChange(next === RATING_FILTER_ALL ? null : (next as HumanRating))
      }
    >
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Filter by rating" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={RATING_FILTER_ALL}>All ratings</SelectItem>
        {HUMAN_RATING_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function HumansFieldFilters({
  value,
  onChange,
}: {
  value: HumanFieldFilters
  onChange: (next: HumanFieldFilters) => void
}) {
  const activeCount = countActiveFieldFilters(value)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {activeCount > 0 && (
            <Badge variant="secondary" className="ml-1">
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Filter by attribute</span>
          {activeCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onChange({})}
            >
              <X className="mr-1 h-3 w-3" />
              Clear
            </Button>
          )}
        </div>
        {HUMAN_FIELD_FILTER_DEFS.map((def) => (
          <div key={def.key} className="space-y-1">
            <Label htmlFor={`human-filter-${def.key}`} className="text-xs">
              {def.label}
            </Label>
            <Input
              id={`human-filter-${def.key}`}
              value={value[def.key] ?? ""}
              placeholder={def.placeholder}
              onChange={(e) =>
                onChange({ ...value, [def.key]: e.target.value })
              }
            />
          </div>
        ))}
      </PopoverContent>
    </Popover>
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
  const applicationFilter =
    searchParams.applicationFilter ?? HUMAN_APPLICATION_FILTER.ALL
  const requiresPopupForFilter =
    applicationFilter === HUMAN_APPLICATION_FILTER.INCOMPLETE &&
    !selectedPopupId

  // Field filters live in local state (snappy typing); the query reads a
  // debounced snapshot so each keystroke doesn't fire a request.
  const [fieldFilters, setFieldFilters] = useState<HumanFieldFilters>({})
  const debouncedFieldFilters = useDebouncedValue(fieldFilters, 300)
  const handleFieldFiltersChange = (next: HumanFieldFilters) => {
    setFieldFilters(next)
    // New filter criteria → back to the first page.
    if (pagination.pageIndex !== 0) {
      setPagination({ pageIndex: 0, pageSize: pagination.pageSize })
    }
  }

  const [ratingFilter, setRatingFilter] = useState<HumanRating | null>(null)
  const handleRatingFilterChange = (next: HumanRating | null) => {
    setRatingFilter(next)
    // New filter criteria → back to the first page.
    if (pagination.pageIndex !== 0) {
      setPagination({ pageIndex: 0, pageSize: pagination.pageSize })
    }
  }

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
      debouncedFieldFilters,
      ratingFilter,
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
        <div className="flex items-center gap-2">
          <HumansApplicationFilterSelect
            value={applicationFilter}
            onValueChange={setApplicationFilter}
          />
          <HumansRatingFilterSelect
            value={ratingFilter}
            onValueChange={handleRatingFilterChange}
          />
          <HumansFieldFilters
            value={fieldFilters}
            onChange={handleFieldFiltersChange}
          />
        </div>
      }
      serverPagination={{
        total: humans.paging.total,
        pagination: pagination,
        onPaginationChange: setPagination,
      }}
      emptyState={
        !search ? (
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

function AddHumanButton() {
  return (
    <Button asChild>
      <Link to="/humans/new">
        <Plus className="mr-2 h-4 w-4" />
        Create Human
      </Link>
    </Button>
  )
}

function Humans() {
  const { needsTenantSelection, isContextReady } = useWorkspace()
  const { isSuperadmin } = useAuth()

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
        {isSuperadmin && isContextReady && <AddHumanButton />}
      </div>
      {!needsTenantSelection && <HumansTable />}
    </div>
  )
}
