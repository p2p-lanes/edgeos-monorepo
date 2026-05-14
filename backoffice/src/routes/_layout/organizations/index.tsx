import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { Building, Plus } from "lucide-react"
import { Suspense } from "react"

import { type TenantPublic, TenantsService } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"

import { Skeleton } from "@/components/ui/skeleton"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"

function getTenantsQueryOptions(
  page: number,
  pageSize: number,
  search?: string,
) {
  return {
    queryFn: () =>
      TenantsService.listTenants({
        skip: page * pageSize,
        limit: pageSize,
        search: search || undefined,
      }),
    queryKey: ["tenants", { page, pageSize, search }],
  }
}

export const Route = createFileRoute("/_layout/organizations/")({
  component: Tenants,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [{ title: "Organizations - EdgeOS" }],
  }),
})

function AddTenantButton() {
  return (
    <Button asChild>
      <Link to="/organizations/new">
        <Plus className="mr-2 h-4 w-4" />
        Add Organization
      </Link>
    </Button>
  )
}

const columns: ColumnDef<TenantPublic>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader label="Name" column={column} />,
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "sender_email",
    header: "Sender Email",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.sender_email || "Default"}
      </span>
    ),
  },
  {
    accessorKey: "deleted",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge status={row.original.deleted ? "deleted" : "active"} />
    ),
  },
]

function TenantsTableContent() {
  const navigate = useNavigate()
  const searchParams = Route.useSearch()
  const { search, pagination, setSearch, setPagination } = useTableSearchParams(
    searchParams,
    "/organizations",
  )

  const { data: tenants } = useQuery({
    ...getTenantsQueryOptions(
      pagination.pageIndex,
      pagination.pageSize,
      search,
    ),
    placeholderData: keepPreviousData,
  })

  if (!tenants) return <Skeleton className="h-64 w-full" />

  return (
    <DataTable
      columns={columns}
      data={tenants.results}
      searchPlaceholder="Search by name..."
      hiddenOnMobile={["sender_email", "deleted"]}
      searchValue={search}
      onSearchChange={setSearch}
      onRowClick={(tenant) =>
        navigate({ to: "/organizations/$id/edit", params: { id: tenant.id } })
      }
      serverPagination={{
        total: tenants.paging.total,
        pagination: pagination,
        onPaginationChange: setPagination,
      }}
      emptyState={
        !search ? (
          <EmptyState
            icon={Building}
            title="No organizations yet"
            description="Create your first organization to start managing the platform."
            action={
              <Button asChild>
                <Link to="/organizations/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Organization
                </Link>
              </Button>
            }
          />
        ) : undefined
      }
    />
  )
}

function Tenants() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Organizations</h1>
          <p className="text-muted-foreground">Manage organizations</p>
        </div>
        <AddTenantButton />
      </div>
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <TenantsTableContent />
        </Suspense>
      </QueryErrorBoundary>
    </div>
  )
}
