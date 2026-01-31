import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { EllipsisVertical, Eye, Pencil, Plus, Trash2 } from "lucide-react"
import { Suspense, useState } from "react"

import { type ProductPublic, ProductsService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

function getProductsQueryOptions(popupId: string | null) {
  return {
    queryFn: () =>
      ProductsService.listProducts({
        skip: 0,
        limit: 100,
        popupId: popupId || undefined,
      }),
    queryKey: ["products", popupId],
  }
}

export const Route = createFileRoute("/_layout/products/")({
  component: Products,
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { isAdmin } = useAuth()

  const deleteMutation = useMutation({
    mutationFn: () => ProductsService.deleteProduct({ productId: product.id }),
    onSuccess: () => {
      showSuccessToast("Product deleted")
      setDeleteDialogOpen(false)
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  })

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Product actions">
            <EllipsisVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link to="/products/$id/edit" params={{ id: product.id }}>
              {isAdmin ? (
                <>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </>
              ) : (
                <>
                  <Eye className="mr-2 h-4 w-4" />
                  View
                </>
              )}
            </Link>
          </DropdownMenuItem>
          {isAdmin && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                setMenuOpen(false)
                setDeleteDialogOpen(true)
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{product.name}"? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={deleteMutation.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <LoadingButton
              variant="destructive"
              loading={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              Delete
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

const columns: ColumnDef<ProductPublic>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "price",
    header: "Price",
    cell: ({ row }) => <span className="font-mono">${row.original.price}</span>,
  },
  {
    accessorKey: "attendee_category",
    header: "Category",
    cell: ({ row }) => (
      <Badge variant="outline">{row.original.attendee_category || "N/A"}</Badge>
    ),
  },
  {
    accessorKey: "is_active",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={row.original.is_active ? "default" : "secondary"}>
        {row.original.is_active ? "Active" : "Inactive"}
      </Badge>
    ),
  },
  {
    id: "actions",
    cell: ({ row }) => (
      <div className="flex justify-end">
        <ProductActionsMenu product={row.original} />
      </div>
    ),
  },
]

function ProductsTableContent() {
  const { selectedPopupId } = useWorkspace()
  const { data: products } = useSuspenseQuery(
    getProductsQueryOptions(selectedPopupId),
  )
  return <DataTable columns={columns} data={products.results} />
}

function Products() {
  const { isAdmin } = useAuth()
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
        {isAdmin && isContextReady && <AddProductButton />}
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
