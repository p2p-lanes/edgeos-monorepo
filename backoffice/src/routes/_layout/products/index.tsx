import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import {
  Check,
  EllipsisVertical,
  Package,
  PackageCheck,
  PackageX,
  Plus,
  QrCode,
  ShieldCheck,
} from "lucide-react"
import { Suspense, useCallback } from "react"

import { type ProductPublic, ProductsService } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import useCustomToast from "@/hooks/useCustomToast"
import {
  type TableSearchParams,
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import { cn } from "@/lib/utils"
import { createErrorHandler } from "@/utils"

// Exported for tests. A product is sold out when the manual override flag is
// set or its remaining stock is tracked and depleted.
export function isProductSoldOut(product: ProductPublic): boolean {
  const remaining = product.total_stock_remaining
  return (
    product.sold_out_override === true || (remaining != null && remaining <= 0)
  )
}

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
  category?: string,
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
        category: category || undefined,
        sortBy: sortBy || undefined,
        sortOrder: sortOrder || undefined,
      }),
    queryKey: [
      "products",
      popupId,
      { page, pageSize, search, category, sortBy, sortOrder },
    ],
  }
}

type ProductsSearchParams = TableSearchParams & {
  category?: string
}

export const Route = createFileRoute("/_layout/products/")({
  component: Products,
  validateSearch: (raw: Record<string, unknown>): ProductsSearchParams => ({
    ...validateTableSearch(raw),
    ...(typeof raw.category === "string" && raw.category
      ? { category: raw.category }
      : {}),
  }),
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

function ProductActionsMenu({ product }: { product: ProductPublic }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { isOperatorOrAbove } = useAuth()
  // The menu toggles the override flag only: a naturally depleted product
  // (override off, stock 0) still offers "Mark as sold out" so it stays
  // sold out even if stock returns.
  const soldOutOverride = product.sold_out_override === true

  const soldOutMutation = useMutation({
    mutationFn: (nextSoldOut: boolean) =>
      ProductsService.setProductSoldOut({
        productId: product.id,
        requestBody: { sold_out: nextSoldOut },
      }),
    onSuccess: (_, nextSoldOut) => {
      showSuccessToast(
        nextSoldOut ? "Product marked as sold out" : "Product available again",
      )
      queryClient.invalidateQueries({ queryKey: ["products"] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  if (!isOperatorOrAbove) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Product actions">
          <EllipsisVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {soldOutOverride ? (
          <DropdownMenuItem
            disabled={soldOutMutation.isPending}
            onSelect={() => soldOutMutation.mutate(false)}
          >
            <PackageCheck className="mr-2 h-4 w-4" />
            Unmark sold out
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            variant="destructive"
            disabled={soldOutMutation.isPending}
            onSelect={() => soldOutMutation.mutate(true)}
          >
            <PackageX className="mr-2 h-4 w-4" />
            Mark as sold out
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
            row.original.is_active ? "bg-success" : "bg-destructive",
          )}
        />
        <span className="font-medium">{row.original.name}</span>
        {isProductSoldOut(row.original) && (
          <Badge variant="destructive">Sold out</Badge>
        )}
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
    accessorKey: "category",
    header: ({ column }) => <SortableHeader label="Category" column={column} />,
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
      row.original.exclusive ? (
        <Check className="h-4 w-4 text-muted-foreground" aria-label="Yes" />
      ) : null,
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
          <Check className="h-4 w-4 text-muted-foreground" aria-label="Yes" />
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
          <Check className="h-4 w-4 text-muted-foreground" aria-label="Yes" />
        ) : null}
      </div>
    ),
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    meta: { toggleable: false },
    cell: ({ row }) => (
      <div className="flex justify-end">
        <ProductActionsMenu product={row.original} />
      </div>
    ),
  },
]

function ProductCategoryFilter({
  categories,
  selected,
  onSelect,
}: {
  categories: string[]
  selected: string | undefined
  onSelect: (value: string | undefined) => void
}) {
  return (
    <Select
      value={selected ?? "all"}
      onValueChange={(v) => onSelect(v === "all" ? undefined : v)}
    >
      <SelectTrigger className="h-9 w-[170px]">
        <SelectValue placeholder="All categories" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All categories</SelectItem>
        {categories.map((c) => (
          <SelectItem key={c} value={c}>
            {c}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

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
  const { category } = searchParams

  const setCategory = useCallback(
    (value: string | undefined) => {
      navigate({
        to: "/products",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          category: value,
          page: 0,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  const { data: products } = useQuery({
    ...getProductsQueryOptions(
      selectedPopupId,
      pagination.pageIndex,
      pagination.pageSize,
      search,
      category,
      sortBy,
      sortOrder,
    ),
    placeholderData: keepPreviousData,
  })

  const { data: categories } = useQuery({
    queryKey: ["product-categories", selectedPopupId],
    queryFn: () =>
      ProductsService.listProductCategories({ popupId: selectedPopupId! }),
    enabled: !!selectedPopupId,
  })

  if (!products) return <Skeleton className="h-64 w-full" />

  return (
    <DataTable
      columns={columns}
      data={products.results}
      searchPlaceholder="Search by name..."
      hiddenOnMobile={[
        "description",
        "category",
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
      filterBar={
        <div className="flex flex-wrap items-center gap-2">
          <ProductCategoryFilter
            categories={categories ?? []}
            selected={category}
            onSelect={setCategory}
          />
          {category && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCategory(undefined)}
            >
              Clear
            </Button>
          )}
        </div>
      }
      emptyState={
        category ? (
          <EmptyState
            icon={Package}
            title="No products match this category"
            description="Try a different category or clear the filter above."
          />
        ) : !search ? (
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
            Manage tickets and products for your gatherings
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
