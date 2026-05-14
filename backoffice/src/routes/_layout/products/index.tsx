import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { Package, Plus } from "lucide-react"
import { Suspense } from "react"

import { type ProductPublic, ProductsService } from "@/client"
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

function getProductsQueryOptions(
  popupId: string | null,
  page: number,
  pageSize: number,
  search?: string,
  sortBy?: string,
  sortOrder?: "asc" | "desc",
) {
  return {
    queryFn: () =>
      ProductsService.listProducts({
        skip: page * pageSize,
        limit: pageSize,
        popupId: popupId || undefined,
        search: search || undefined,
        sortBy: sortBy || undefined,
        sortOrder: sortOrder || undefined,
      }),
    queryKey: [
      "products",
      popupId,
      { page, pageSize, search, sortBy, sortOrder },
    ],
  }
}

export const Route = createFileRoute("/_layout/products/")({
  component: Products,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [{ title: "Products - EdgeOS" }],
  }),
})

function AddProductButton() {
  return (
    <Button asChild>
      <Link to="/products/new">
        <Plus className="mr-2 h-4 w-4" />
        Add Product
      </Link>
    </Button>
  )
}

const columns: ColumnDef<ProductPublic>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader label="Name" column={column} />,
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "price",
    header: ({ column }) => <SortableHeader label="Price" column={column} />,
    cell: ({ row }) => <span className="font-mono">${row.original.price}</span>,
  },
  {
    accessorKey: "attendee_category",
    header: "Category",
    cell: ({ row }) => <StatusBadge status={row.original.category || "N/A"} />,
  },
  {
    accessorKey: "insurance_eligible",
    header: "Insurance",
    cell: ({ row }) => {
      return row.original.insurance_eligible ? (
        <StatusBadge status="active" />
      ) : (
        <span className="text-muted-foreground">—</span>
      )
    },
  },
  {
    accessorKey: "is_active",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge status={row.original.is_active ? "active" : "inactive"} />
    ),
  },
]

function ProductsTableContent() {
  const navigate = useNavigate()
  const { selectedPopupId } = useWorkspace()
  const searchParams = Route.useSearch()
  const {
    search,
    pagination,
    sorting,
    sortBy,
    sortOrder,
    setSearch,
    setPagination,
    setSorting,
  } = useTableSearchParams(searchParams, "/products")

  const { data: products } = useQuery({
    ...getProductsQueryOptions(
      selectedPopupId,
      pagination.pageIndex,
      pagination.pageSize,
      search,
      sortBy,
      sortOrder,
    ),
    placeholderData: keepPreviousData,
  })

  if (!products) return <Skeleton className="h-64 w-full" />

  return (
    <DataTable
      columns={columns}
      data={products.results}
      searchPlaceholder="Search by name..."
      hiddenOnMobile={["attendee_category", "insurance_eligible", "is_active"]}
      searchValue={search}
      onSearchChange={setSearch}
      onRowClick={(product) =>
        navigate({ to: "/products/$id/edit", params: { id: product.id } })
      }
      serverPagination={{
        total: products.paging.total,
        pagination: pagination,
        onPaginationChange: setPagination,
      }}
      serverSorting={{
        sorting: sorting,
        onSortingChange: setSorting,
      }}
      emptyState={
        !search ? (
          <EmptyState
            icon={Package}
            title="No products yet"
            description="Create your first product or ticket to start selling."
            action={
              <Button asChild>
                <Link to="/products/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Product
                </Link>
              </Button>
            }
          />
        ) : undefined
      }
    />
  )
}

function Products() {
  const { isOperatorOrAbove } = useAuth()
  const { isContextReady } = useWorkspace()

  return (
    <div className="flex flex-col gap-6">
      {!isContextReady && <WorkspaceAlert resource="products" />}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products</h1>
          <p className="text-muted-foreground">
            Manage tickets and products for your popups
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isOperatorOrAbove && isContextReady && <AddProductButton />}
        </div>
      </div>
      {isContextReady && (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <ProductsTableContent />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
