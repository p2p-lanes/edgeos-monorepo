import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { Plus, Tag } from "lucide-react"
import { Suspense } from "react"

import { type CouponPublic, CouponsService } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"

function getCouponsQueryOptions(
  popupId: string | null,
  page: number,
  pageSize: number,
  search?: string,
) {
  return {
    queryFn: () =>
      CouponsService.listCoupons({
        popupId: popupId ?? undefined,
        skip: page * pageSize,
        limit: pageSize,
        search: search || undefined,
      }),
    queryKey: ["coupons", { popupId, page, pageSize, search }],
  }
}

export const Route = createFileRoute("/_layout/coupons/")({
  component: Coupons,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [{ title: "Coupons - EdgeOS" }],
  }),
})

function AddCouponButton() {
  return (
    <Button asChild>
      <Link to="/coupons/new">
        <Plus className="mr-2 h-4 w-4" />
        Add Coupon
      </Link>
    </Button>
  )
}

const columns: ColumnDef<CouponPublic>[] = [
  {
    accessorKey: "code",
    header: ({ column }) => <SortableHeader label="Code" column={column} />,
    cell: ({ row }) => (
      <span className="font-mono font-medium">{row.original.code}</span>
    ),
  },
  {
    accessorKey: "discount_value",
    header: ({ column }) => <SortableHeader label="Discount" column={column} />,
    cell: ({ row }) => <span>{row.original.discount_value}%</span>,
  },
  {
    accessorKey: "current_uses",
    header: "Uses",
    cell: ({ row }) => (
      <span>
        {row.original.current_uses}
        {row.original.max_uses ? ` / ${row.original.max_uses}` : ""}
      </span>
    ),
  },
  {
    accessorKey: "is_active",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge status={row.original.is_active ? "active" : "inactive"} />
    ),
  },
]

function CouponsTableContent({ popupId }: { popupId: string | null }) {
  const navigate = useNavigate()
  const searchParams = Route.useSearch()
  const { search, pagination, setSearch, setPagination } = useTableSearchParams(
    searchParams,
    "/coupons",
  )

  const { data: coupons } = useQuery({
    ...getCouponsQueryOptions(
      popupId,
      pagination.pageIndex,
      pagination.pageSize,
      search,
    ),
    placeholderData: keepPreviousData,
  })

  if (!coupons) return <Skeleton className="h-64 w-full" />

  return (
    <DataTable
      columns={columns}
      data={coupons.results}
      searchPlaceholder="Search by code..."
      hiddenOnMobile={["current_uses", "is_active"]}
      searchValue={search}
      onSearchChange={setSearch}
      onRowClick={(coupon) =>
        navigate({ to: "/coupons/$id/edit", params: { id: coupon.id } })
      }
      serverPagination={{
        total: coupons.paging.total,
        pagination: pagination,
        onPaginationChange: setPagination,
      }}
      emptyState={
        !search ? (
          <EmptyState
            icon={Tag}
            title="No coupons yet"
            description="Create discount codes to offer special pricing to your attendees."
            action={
              <Button asChild>
                <Link to="/coupons/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Coupon
                </Link>
              </Button>
            }
          />
        ) : undefined
      }
    />
  )
}

function Coupons() {
  const { isOperatorOrAbove } = useAuth()
  const { selectedPopupId, isContextReady } = useWorkspace()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Coupons</h1>
          <p className="text-muted-foreground">
            Manage discount codes for your gatherings
          </p>
        </div>
        {isOperatorOrAbove && isContextReady && <AddCouponButton />}
      </div>
      {!isContextReady ? (
        <WorkspaceAlert resource="coupons" />
      ) : (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <CouponsTableContent popupId={selectedPopupId} />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
