import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { EllipsisVertical, Pencil, Plus, Trash2 } from "lucide-react"
import { Suspense, useState } from "react"

import { type TenantPublic, TenantsService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { Skeleton } from "@/components/ui/skeleton"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

function getTenantsQueryOptions() {
  return {
    queryFn: () => TenantsService.listTenants({ skip: 0, limit: 100 }),
    queryKey: ["tenants"],
  }
}

export const Route = createFileRoute("/_layout/tenants/")({
  component: Tenants,
  head: () => ({
    meta: [{ title: "Tenants - EdgeOS" }],
  }),
})

function AddTenantButton() {
  return (
    <Button asChild>
      <Link to="/tenants/new">
        <Plus className="mr-2 h-4 w-4" />
        Add Tenant
      </Link>
    </Button>
  )
}

function TenantActionsMenu({ tenant }: { tenant: TenantPublic }) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const deleteMutation = useMutation({
    mutationFn: () => TenantsService.deleteTenant({ tenantId: tenant.id }),
    onSuccess: () => {
      showSuccessToast("Tenant deleted")
      setOpen(false)
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["tenants"] }),
  })

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Tenant actions">
          <EllipsisVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to="/tenants/$id/edit" params={{ id: tenant.id }}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={() => deleteMutation.mutate()}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const columns: ColumnDef<TenantPublic>[] = [
  {
    accessorKey: "name",
    header: "Name",
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
      <Badge variant={row.original.deleted ? "destructive" : "default"}>
        {row.original.deleted ? "Deleted" : "Active"}
      </Badge>
    ),
  },
  {
    id: "actions",
    cell: ({ row }) => (
      <div className="flex justify-end">
        <TenantActionsMenu tenant={row.original} />
      </div>
    ),
  },
]

function TenantsTableContent() {
  const { data: tenants } = useSuspenseQuery(getTenantsQueryOptions())
  return <DataTable columns={columns} data={tenants.results} />
}

function Tenants() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tenants</h1>
          <p className="text-muted-foreground">
            Manage platform tenants and organizations
          </p>
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
