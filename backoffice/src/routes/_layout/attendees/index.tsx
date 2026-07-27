import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import {
  Download,
  EllipsisVertical,
  Gift,
  Pencil,
  Users,
  X,
} from "lucide-react"
import { Suspense, useCallback, useEffect, useMemo, useState } from "react"

import {
  AttendeeCategoriesService,
  type AttendeeListItem,
  AttendeesService,
} from "@/client"
import { ProductsCell } from "@/components/Attendees/ProductsCell"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import {
  EMPTYABLE_TEXT_OPS,
  FilterBuilder,
  type FilterCondition,
  type FilterFieldDef,
  type FilterMatch,
  FULL_TEXT_OPS,
  isCompleteCondition,
  sanitizeFilterConditions,
} from "@/components/Common/FilterBuilder"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { SavedViewsMenu } from "@/components/Common/SavedViewsMenu"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import {
  type TableSearchParams,
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import { readAgeGroup } from "@/lib/age-group"
import { exportToCsv, fetchAllPages } from "@/lib/export"

// ── CSV flattening helper ─────────────────────────────────────────────────────

type FlatAttendeeRow = {
  name: string
  email: string | null | undefined
  category: string
  gender: string | null | undefined
  age_group: string
  product_id: string
}

/**
 * Expand each attendee into one row per purchased ticket.
 * Attendees with no products emit a single row with an empty product_id so
 * they still appear in the CSV. Per-ticket check_in_codes are not exported
 * here — the list endpoint does not carry them; staff can read them from
 * the attendee edit page.
 *
 * age_group (baby/kid/teen) is read from additional_data for "kid" attendees;
 * blank for everyone else.
 */
export function flattenAttendeesForCsv(
  attendees: AttendeeListItem[],
): FlatAttendeeRow[] {
  return attendees.flatMap((att) => {
    const base = {
      name: att.name,
      email: att.email,
      category: att.category ?? "",
      gender: att.gender,
      age_group: readAgeGroup(att) ?? "",
    }
    const products = att.products ?? []
    if (products.length === 0) {
      return [{ ...base, product_id: "" }]
    }
    return products.map((p) => ({ ...base, product_id: String(p.id) }))
  })
}

function getAttendeesQueryOptions(
  popupId: string | null,
  page: number,
  pageSize: number,
  search?: string,
  filters?: string,
) {
  return {
    queryFn: () =>
      AttendeesService.listAttendees({
        skip: page * pageSize,
        limit: pageSize,
        popupId: popupId || undefined,
        search: search || undefined,
        filters,
      }),
    queryKey: ["attendees", popupId, { page, pageSize, search, filters }],
  }
}

type AttendeesSearchParams = TableSearchParams & {
  match?: FilterMatch
  filters?: FilterCondition[]
}

export const Route = createFileRoute("/_layout/attendees/")({
  component: Attendees,
  validateSearch: (raw: Record<string, unknown>): AttendeesSearchParams => {
    const filters = sanitizeFilterConditions(raw.filters)
    // Legacy ?hasTickets= and ?categoryId= links fold into filter conditions.
    if (
      (raw.hasTickets === true || raw.hasTickets === "true") &&
      !filters.some((condition) => condition.field === "has_tickets")
    ) {
      filters.push({ field: "has_tickets", op: "eq", value: true })
    }
    if (
      typeof raw.categoryId === "string" &&
      raw.categoryId &&
      !filters.some((condition) => condition.field === "category_id")
    ) {
      filters.push({ field: "category_id", op: "eq", value: raw.categoryId })
    }
    return {
      ...validateTableSearch(raw),
      ...(raw.match === "any" && filters.length
        ? { match: "any" as const }
        : {}),
      ...(filters.length ? { filters } : {}),
    }
  },
  head: () => ({
    meta: [{ title: "Attendees - EdgeOS" }],
  }),
})

// Single source for the filter-related search params, shared by the table
// and the CSV export so both always query the same subset.
function useAttendeesFilterParams() {
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
  return {
    search: searchParams.search ?? "",
    filterMatch,
    filterConditions,
    filtersJson,
  }
}

const ATTENDEE_DATE_OPS = ["before", "after"]

function buildAttendeeFieldDefs(
  categoryOptions: { value: string; label: string }[],
): FilterFieldDef[] {
  return [
    { key: "name", label: "Name", kind: "text", ops: FULL_TEXT_OPS },
    { key: "email", label: "Email", kind: "text", ops: FULL_TEXT_OPS },
    ...(categoryOptions.length
      ? [
          {
            key: "category_id",
            label: "Category",
            kind: "select",
            ops: ["eq", "neq"],
            options: categoryOptions,
          } satisfies FilterFieldDef,
        ]
      : []),
    { key: "gender", label: "Gender", kind: "text", ops: EMPTYABLE_TEXT_OPS },
    {
      key: "created_at",
      label: "Created",
      kind: "date",
      ops: ATTENDEE_DATE_OPS,
    },
    { key: "has_tickets", label: "Has tickets", kind: "boolean", ops: ["eq"] },
  ]
}

function AttendeeActionsMenu({ attendee }: { attendee: AttendeeListItem }) {
  const navigate = useNavigate()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Attendee actions">
          <EllipsisVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() =>
            navigate({
              to: "/attendees/$attendeeId",
              params: { attendeeId: attendee.id },
            })
          }
        >
          <Pencil className="mr-2 h-4 w-4" />
          Edit
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const columns: ColumnDef<AttendeeListItem>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader label="Name" column={column} />,
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "email",
    header: ({ column }) => <SortableHeader label="Email" column={column} />,
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.email || "N/A"}
      </span>
    ),
  },
  {
    accessorKey: "category",
    header: "Category",
    cell: ({ row }) => <Badge variant="outline">{row.original.category}</Badge>,
  },
  {
    id: "products",
    header: "Tickets",
    meta: { label: "Tickets" },
    cell: ({ row }) => <ProductsCell products={row.original.products} />,
  },
  {
    accessorKey: "gender",
    header: "Gender",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.gender || "N/A"}
      </span>
    ),
  },
  {
    id: "age_group",
    header: "Age group",
    meta: { label: "Age group" },
    cell: ({ row }) => {
      const ageGroup = readAgeGroup(row.original)
      return (
        <span className="capitalize text-muted-foreground">
          {ageGroup || "N/A"}
        </span>
      )
    },
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <AttendeeActionsMenu attendee={row.original} />
      </div>
    ),
  },
]

function AttendeesTableContent() {
  const { selectedPopupId } = useWorkspace()
  const navigate = useNavigate()
  const searchParams = Route.useSearch()
  const { search, pagination, setSearch, setPagination } = useTableSearchParams(
    searchParams,
    "/attendees",
  )
  const { filterMatch, filterConditions, filtersJson } =
    useAttendeesFilterParams()

  const setFilters = useCallback(
    (match: FilterMatch, conditions: FilterCondition[]) => {
      navigate({
        to: "/attendees",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          // Scrub the legacy params so validateSearch cannot fold them back
          // into resurrected conditions after the user edits the filters.
          hasTickets: undefined,
          categoryId: undefined,
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
      to: "/attendees",
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        hasTickets: undefined,
        categoryId: undefined,
        match: undefined,
        filters: undefined,
        search: undefined,
        page: 0,
      }),
      replace: true,
    })
  }, [navigate])

  const savedViewConfig = useMemo(() => {
    const config: Record<string, unknown> = {}
    if (filterMatch === "any" && filterConditions.length) config.match = "any"
    if (filterConditions.length) config.filters = filterConditions
    if (search) config.search = search
    return config
  }, [filterMatch, filterConditions, search])

  const applySavedView = useCallback(
    (config: Record<string, unknown>) => {
      const filters = sanitizeFilterConditions(config.filters)
      navigate({
        to: "/attendees",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          hasTickets: undefined,
          categoryId: undefined,
          page: 0,
          match:
            config.match === "any" && filters.length
              ? ("any" as const)
              : undefined,
          filters: filters.length ? filters : undefined,
          search:
            typeof config.search === "string" && config.search
              ? config.search
              : undefined,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  const { data: categoriesData } = useQuery({
    queryKey: ["attendee-categories", selectedPopupId],
    queryFn: () =>
      AttendeeCategoriesService.listAttendeeCategories({
        popupId: selectedPopupId!,
      }),
    enabled: !!selectedPopupId,
  })
  const categories = categoriesData?.results ?? []

  // Drop category conditions that reference categories outside the current
  // popup (e.g. after switching gatherings).
  useEffect(() => {
    if (!categoriesData) return
    const isInvalid = (condition: FilterCondition) =>
      condition.field === "category_id" &&
      !categories.some((category) => category.id === condition.value)
    if (filterConditions.some(isInvalid)) {
      setFilters(
        filterMatch,
        filterConditions.filter((condition) => !isInvalid(condition)),
      )
    }
  }, [categoriesData, categories, filterConditions, filterMatch, setFilters])

  const fieldDefs = useMemo(
    () =>
      buildAttendeeFieldDefs(
        categories.map((category) => ({
          value: category.id,
          label: category.key,
        })),
      ),
    [categories],
  )

  const { data: attendees } = useQuery({
    ...getAttendeesQueryOptions(
      selectedPopupId,
      pagination.pageIndex,
      pagination.pageSize,
      search,
      filtersJson,
    ),
    placeholderData: keepPreviousData,
  })

  if (!attendees) return <Skeleton className="h-64 w-full" />

  return (
    <DataTable
      columns={columns}
      data={attendees.results}
      searchPlaceholder="Search by name or email..."
      hiddenOnMobile={["gender", "category", "age_group"]}
      searchValue={search}
      onSearchChange={setSearch}
      onRowClick={(row) =>
        navigate({
          to: "/attendees/$attendeeId",
          params: { attendeeId: row.id },
        })
      }
      filterBar={
        <div className="flex flex-wrap items-center gap-2">
          <FilterBuilder
            fields={fieldDefs}
            match={filterMatch}
            conditions={filterConditions}
            onChange={setFilters}
            emptyMessage="No filters applied. Add a filter to narrow down attendees."
          />
          {selectedPopupId && (
            <SavedViewsMenu
              popupId={selectedPopupId}
              entity="attendees"
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
      }
      serverPagination={{
        total: attendees.paging.total,
        pagination,
        onPaginationChange: setPagination,
      }}
      emptyState={
        !search && !filterConditions.length ? (
          <EmptyState
            icon={Users}
            title="No attendees yet"
            description="Attendees will appear here once applications are approved and check-ins begin."
          />
        ) : undefined
      }
    />
  )
}

function Attendees() {
  const { isContextReady } = useWorkspace()
  const { selectedPopupId } = useWorkspace()
  const { isOperatorOrAbove } = useAuth()
  const { search, filtersJson } = useAttendeesFilterParams()
  const [isExporting, setIsExporting] = useState(false)

  // Export what the table shows: the same search and filter conditions drive
  // the fetch, just without pagination.
  const isExportFiltered = Boolean(search || filtersJson)
  const handleExport = async () => {
    if (!selectedPopupId) return
    setIsExporting(true)
    try {
      const results = await fetchAllPages((skip, limit) =>
        AttendeesService.listAttendees({
          skip,
          limit,
          popupId: selectedPopupId,
          search: search || undefined,
          filters: filtersJson,
        }),
      )
      const rows = flattenAttendeesForCsv(results as AttendeeListItem[])
      exportToCsv(
        isExportFiltered ? "attendees-filtered" : "attendees",
        rows as unknown as Record<string, unknown>[],
        [
          { key: "name", label: "Name" },
          { key: "email", label: "Email" },
          { key: "category", label: "Category" },
          { key: "gender", label: "Gender" },
          { key: "age_group", label: "Age group" },
          { key: "product_id", label: "Product ID" },
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
          <h1 className="text-2xl font-bold tracking-tight">Attendees</h1>
          <p className="text-muted-foreground">
            Manage event attendees and check-ins
          </p>
        </div>
        {isContextReady && (
          <div className="flex items-center gap-2">
            {isOperatorOrAbove && selectedPopupId && (
              <Button asChild>
                <Link
                  to="/popups/$id/bulk-grant"
                  params={{ id: selectedPopupId }}
                >
                  <Gift className="mr-2 h-4 w-4" />
                  Invite
                </Link>
              </Button>
            )}
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={isExporting}
              title={
                isExportFiltered
                  ? "Exports the attendees matching the current filters"
                  : "Exports all attendees for this gathering"
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
      {!isContextReady ? (
        <WorkspaceAlert resource="attendees" />
      ) : (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <AttendeesTableContent />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
