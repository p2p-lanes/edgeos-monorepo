import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { Package, Plus, QrCode, ShieldCheck } from "lucide-react"
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
import { cn } from "@/lib/utils"

const DURATION_LABELS: Record<string, string> = {
  day: "Day Pass",
  week: "Week Pass",
  month: "Month Pass",
  full: "Full Event",
}

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
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <span
          role="img"
          aria-label={row.original.is_active ? "Active" : "Inactive"}
          title={row.original.is_active ? "Active" : "Inactive"}
          className={cn(
            "size-2 shrink-0 rounded-full",
            row.original.is_active ? "bg-green-500" : "bg-red-500",
          )}
        />
        <span className="font-medium">{row.original.name}</span>
      </div>
    ),
  },
  {
    accessorKey: "description",
    header: "Description",
    cell: ({ row }) => {
      const description = row.original.description
      if (!description) return null
      return (
        <span className="line-clamp-2 max-w-xs text-sm leading-snug text-muted-foreground">
          {description}
        </span>
      )
    },
  },
  {
    accessorKey: "price",
    header: ({ column }) => <SortableHeader label="Price" column={column} />,
    cell: ({ row }) => (
      <div className="flex flex-col leading-tight">
        {row.original.compare_price ? (
          <span className="font-mono text-xs text-muted-foreground line-through">
            ${row.original.compare_price}
          </span>
        ) : null}
        <span className="font-mono">${row.original.price}</span>
      </div>
    ),
  },
  {
    accessorKey: "attendee_category",
    header: "Category",
    cell: ({ row }) => <StatusBadge status={row.original.category || "N/A"} />,
  },
  {
    accessorKey: "duration_type",
    header: "Duration",
    cell: ({ row }) => {
      const duration = row.original.duration_type
      if (!duration) return null
      return (
        <span className="text-sm">{DURATION_LABELS[duration] ?? duration}</span>
      )
    },
  },
  {
    accessorKey: "exclusive",
    header: "Exclusive",
    cell: ({ row }) =>
      row.original.exclusive ? <StatusBadge status="active" /> : null,
  },
  {
    accessorKey: "insurance_eligible",
    header: () => (
      <div
        title="Insurance Eligible"
        className="flex items-center justify-center"
      >
        <ShieldCheck
          className="h-4 w-4 text-muted-foreground"
          aria-label="Insurance Eligible"
        />
      </div>
    ),
    cell: ({ row }) => (
      <div className="flex items-center justify-center">
        {row.original.insurance_eligible ? (
          <StatusBadge status="active" />
        ) : null}
      </div>
    ),
  },
  {
    accessorKey: "requires_check_in",
    header: () => (
      <div
        title="Requires Check-in"
        className="flex items-center justify-center"
      >
        <QrCode
          className="h-4 w-4 text-muted-foreground"
          aria-label="Requires Check-in"
        />
      </div>
    ),
    cell: ({ row }) => (
      <div className="flex items-center justify-center">
        {row.original.requires_check_in ? (
          <StatusBadge status="active" />
        ) : null}
      </div>
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
      hiddenOnMobile={[
        "description",
        "attendee_category",
        "duration_type",
        "exclusive",
        "insurance_eligible",
        "requires_check_in",
      ]}
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
