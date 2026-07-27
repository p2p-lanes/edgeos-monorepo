import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { ChevronRight } from "lucide-react"
import { useMemo, useState } from "react"

import { type ApplicationPublic, ApplicationsService } from "@/client"
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

interface ApplicationsGroupedViewProps {
  popupId: string
  groupBy: string
  columns: ColumnDef<ApplicationPublic>[]
  filterMatch: FilterMatch
  filterConditions: FilterCondition[]
  search: string
  /** Preferred group ordering (status flow, custom field options). */
  valueOrder?: string[]
  hiddenOnMobile?: string[]
}

export function ApplicationsGroupedView({
  popupId,
  groupBy,
  columns,
  filterMatch,
  filterConditions,
  search,
  valueOrder,
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

  const groups = useMemo(() => {
    if (!counts) return []
    const valued = counts.filter((group) => group.value != null)
    const empty = counts.filter((group) => group.value == null)
    if (valueOrder?.length) {
      const rank = new Map(valueOrder.map((value, index) => [value, index]))
      // Stable sort: values outside the known order keep the backend
      // count-desc order after the known ones.
      valued.sort(
        (a, b) =>
          (rank.get(a.value as string) ?? rank.size) -
          (rank.get(b.value as string) ?? rank.size),
      )
    }
    return [...valued, ...empty]
  }, [counts, valueOrder])

  // Collapsed by default. The caller keys this component by groupBy, so
  // switching the grouped field starts from a fully collapsed state again.
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
            <button
              type="button"
              aria-expanded={open}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/50"
              onClick={() =>
                setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
              }
            >
              <ChevronRight
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  open && "rotate-90",
                )}
              />
              {value === null ? (
                <span className="text-sm text-muted-foreground">No value</span>
              ) : groupBy === "status" ? (
                <StatusBadge status={value} />
              ) : (
                <span className="truncate text-sm font-medium">{value}</span>
              )}
              <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                {group.count}
              </span>
            </button>
            {open && (
              <div className="border-t px-3 pb-3 pt-2">
                {/* Remount on filter/search edits so the page index cannot
                    strand past the new last page. */}
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
  columns,
  filterMatch,
  completeConditions,
  search,
  hiddenOnMobile,
}: {
  popupId: string
  groupBy: string
  value: string | null
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
