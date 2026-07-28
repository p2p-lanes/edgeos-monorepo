import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { ChevronRight } from "lucide-react"
import { useMemo, useState } from "react"

import {
  type ApplicationGroupCount,
  type ApplicationPublic,
  ApplicationsService,
} from "@/client"
import {
  type FilterCondition,
  type FilterMatch,
  isCompleteCondition,
} from "@/components/applications/ApplicationFilterBuilder"
import { DataTable } from "@/components/Common/DataTable"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const EMPTY_GROUP_KEY = "__empty__"
const GROUP_PAGE_SIZE = 25

// NULL bucket last; known values follow the preferred order, the rest keep
// the backend count-desc order after them.
function orderGroups(
  counts: ApplicationGroupCount[],
  valueOrder?: string[],
): ApplicationGroupCount[] {
  const valued = counts.filter((group) => group.value != null)
  const empty = counts.filter((group) => group.value == null)
  if (valueOrder?.length) {
    const rank = new Map(valueOrder.map((value, index) => [value, index]))
    valued.sort(
      (a, b) =>
        (rank.get(a.value as string) ?? rank.size) -
        (rank.get(b.value as string) ?? rank.size),
    )
  }
  return [...valued, ...empty]
}

function GroupHeader({
  field,
  value,
  count,
  open,
  onToggle,
}: {
  field: string
  value: string | null
  count: number
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/50"
      onClick={onToggle}
    >
      <ChevronRight
        className={cn(
          "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
          open && "rotate-90",
        )}
      />
      {value === null ? (
        <span className="text-sm text-muted-foreground">No value</span>
      ) : field === "status" ? (
        <StatusBadge status={value} />
      ) : (
        <span className="truncate text-sm font-medium">{value}</span>
      )}
      <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
        {count}
      </span>
    </button>
  )
}

interface ApplicationsGroupedViewProps {
  popupId: string
  groupBy: string
  /** Optional second grouping level rendered inside each expanded group. */
  subGroupBy?: string
  columns: ColumnDef<ApplicationPublic>[]
  filterMatch: FilterMatch
  filterConditions: FilterCondition[]
  search: string
  /** Preferred group ordering (status flow, custom field options). */
  valueOrder?: string[]
  subValueOrder?: string[]
  hiddenOnMobile?: string[]
}

export function ApplicationsGroupedView({
  popupId,
  groupBy,
  subGroupBy,
  columns,
  filterMatch,
  filterConditions,
  search,
  valueOrder,
  subValueOrder,
  hiddenOnMobile,
}: ApplicationsGroupedViewProps) {
  const completeConditions = useMemo(
    () => filterConditions.filter(isCompleteCondition),
    [filterConditions],
  )
  const baseFiltersJson = useMemo(
    () =>
      completeConditions.length
        ? JSON.stringify({ match: filterMatch, conditions: completeConditions })
        : undefined,
    [completeConditions, filterMatch],
  )

  const {
    data: counts,
    isLoading,
    isError,
  } = useQuery({
    // "applications" prefix keeps this in the workspace invalidation sweep.
    queryKey: [
      "applications",
      popupId,
      "group-counts",
      { groupBy, filters: baseFiltersJson, search },
    ],
    queryFn: () =>
      ApplicationsService.getApplicationGroupCounts({
        popupId,
        groupBy,
        filters: baseFiltersJson,
        search: search || undefined,
      }),
    placeholderData: keepPreviousData,
  })

  const groups = useMemo(
    () => (counts ? orderGroups(counts, valueOrder) : []),
    [counts, valueOrder],
  )

  // Collapsed by default. The caller keys this component by the group
  // fields, so switching either one starts fully collapsed again.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  if (isLoading) return <Skeleton className="h-40 w-full" />
  if (isError) {
    return (
      <p className="text-sm text-muted-foreground">
        Unable to load the groups. Try a different field.
      </p>
    )
  }
  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No applications match the current view.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {groups.map((group) => {
        const value = group.value ?? null
        const key = value ?? EMPTY_GROUP_KEY
        const open = !!expanded[key]
        return (
          <div key={key} className="rounded-lg border">
            <GroupHeader
              field={groupBy}
              value={value}
              count={group.count}
              open={open}
              onToggle={() =>
                setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
              }
            />
            {open && (
              <div className="border-t px-3 pb-3 pt-2">
                {subGroupBy ? (
                  <SubGroupsList
                    key={`${baseFiltersJson ?? ""}|${search}`}
                    popupId={popupId}
                    groupBy={groupBy}
                    groupValue={value}
                    subGroupBy={subGroupBy}
                    columns={columns}
                    filterMatch={filterMatch}
                    completeConditions={completeConditions}
                    baseFiltersJson={baseFiltersJson}
                    search={search}
                    subValueOrder={subValueOrder}
                    hiddenOnMobile={hiddenOnMobile}
                  />
                ) : (
                  /* Remount on filter/search edits so the page index cannot
                     strand past the new last page. */
                  <GroupRowsTable
                    key={`${baseFiltersJson ?? ""}|${search}`}
                    popupId={popupId}
                    groupBy={groupBy}
                    value={value}
                    columns={columns}
                    filterMatch={filterMatch}
                    completeConditions={completeConditions}
                    search={search}
                    hiddenOnMobile={hiddenOnMobile}
                  />
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Second grouping level inside one expanded parent group: same collapsed
// group rows, with counts scoped to the parent bucket.
function SubGroupsList({
  popupId,
  groupBy,
  groupValue,
  subGroupBy,
  columns,
  filterMatch,
  completeConditions,
  baseFiltersJson,
  search,
  subValueOrder,
  hiddenOnMobile,
}: {
  popupId: string
  groupBy: string
  groupValue: string | null
  subGroupBy: string
  columns: ColumnDef<ApplicationPublic>[]
  filterMatch: FilterMatch
  completeConditions: FilterCondition[]
  baseFiltersJson?: string
  search: string
  subValueOrder?: string[]
  hiddenOnMobile?: string[]
}) {
  const {
    data: counts,
    isLoading,
    isError,
  } = useQuery({
    queryKey: [
      "applications",
      popupId,
      "group-counts",
      {
        groupBy: subGroupBy,
        parentGroupBy: groupBy,
        parentGroupValue: groupValue,
        filters: baseFiltersJson,
        search,
      },
    ],
    queryFn: () =>
      ApplicationsService.getApplicationGroupCounts({
        popupId,
        groupBy: subGroupBy,
        parentGroupBy: groupBy,
        parentGroupValue: groupValue ?? undefined,
        filters: baseFiltersJson,
        search: search || undefined,
      }),
    placeholderData: keepPreviousData,
  })

  const groups = useMemo(
    () => (counts ? orderGroups(counts, subValueOrder) : []),
    [counts, subValueOrder],
  )
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  if (isLoading) return <Skeleton className="h-24 w-full" />
  if (isError) {
    return (
      <p className="text-sm text-muted-foreground">
        Unable to load the subgroups. Try a different field.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {groups.map((group) => {
        const value = group.value ?? null
        const key = value ?? EMPTY_GROUP_KEY
        const open = !!expanded[key]
        return (
          <div key={key} className="rounded-lg border">
            <GroupHeader
              field={subGroupBy}
              value={value}
              count={group.count}
              open={open}
              onToggle={() =>
                setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
              }
            />
            {open && (
              <div className="border-t px-3 pb-3 pt-2">
                <GroupRowsTable
                  popupId={popupId}
                  groupBy={groupBy}
                  value={groupValue}
                  subGroupBy={subGroupBy}
                  subValue={value}
                  columns={columns}
                  filterMatch={filterMatch}
                  completeConditions={completeConditions}
                  search={search}
                  hiddenOnMobile={hiddenOnMobile}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function GroupRowsTable({
  popupId,
  groupBy,
  value,
  subGroupBy,
  subValue,
  columns,
  filterMatch,
  completeConditions,
  search,
  hiddenOnMobile,
}: {
  popupId: string
  groupBy: string
  value: string | null
  subGroupBy?: string
  subValue?: string | null
  columns: ColumnDef<ApplicationPublic>[]
  filterMatch: FilterMatch
  completeConditions: FilterCondition[]
  search: string
  hiddenOnMobile?: string[]
}) {
  const navigate = useNavigate()
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: GROUP_PAGE_SIZE,
  })

  // The group scope travels as dedicated params so the backend ANDs it with
  // the filter group; appending a condition would leak rows under match any.
  const filtersJson = useMemo(
    () =>
      completeConditions.length
        ? JSON.stringify({ match: filterMatch, conditions: completeConditions })
        : undefined,
    [completeConditions, filterMatch],
  )

  const { data: applications } = useQuery({
    queryKey: [
      "applications",
      popupId,
      {
        page: pagination.pageIndex,
        pageSize: pagination.pageSize,
        search,
        filters: filtersJson,
        groupBy,
        groupValue: value,
        subGroupBy,
        subGroupValue: subValue,
      },
    ],
    queryFn: () =>
      ApplicationsService.listApplications({
        skip: pagination.pageIndex * pagination.pageSize,
        limit: pagination.pageSize,
        popupId,
        search: search || undefined,
        filters: filtersJson,
        groupBy,
        groupValue: value ?? undefined,
        subGroupBy,
        subGroupValue: subValue ?? undefined,
      }),
    placeholderData: keepPreviousData,
  })

  if (!applications) return <Skeleton className="h-24 w-full" />

  return (
    <DataTable
      columns={columns}
      data={applications.results}
      tableId="applications"
      hideToolbar
      hiddenOnMobile={hiddenOnMobile}
      onRowClick={(application) =>
        navigate({
          to: "/applications/$id",
          params: { id: application.id },
        })
      }
      serverPagination={{
        total: applications.paging.total,
        pagination,
        onPaginationChange: setPagination,
      }}
    />
  )
}
