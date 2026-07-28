import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { format } from "date-fns"
import {
  AlertCircle,
  CalendarDays,
  EllipsisVertical,
  ExternalLink,
  Plus,
  ShoppingCart,
} from "lucide-react"
import { Suspense, useState } from "react"

import { type PopupAdmin, PopupsService, type SaleType } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { useCurrentTenant } from "@/hooks/useCurrentTenant"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import {
  getPopupCheckoutUrl,
  getPopupPortalUrl,
  getPortalBaseUrl,
} from "@/lib/portal-urls"

function getPopupsQueryOptions(
  page: number,
  pageSize: number,
  search?: string,
) {
  return {
    queryFn: () =>
      PopupsService.listPopups({
        skip: page * pageSize,
        limit: pageSize,
        search: search || undefined,
      }),
    queryKey: ["popups", { page, pageSize, search }],
  }
}

export const Route = createFileRoute("/_layout/popups/")({
  component: Popups,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [{ title: "Gatherings - EdgeOS" }],
  }),
})

function AddPopupButton() {
  return (
    <Button asChild>
      <Link to="/popups/new">
        <Plus className="mr-2 h-4 w-4" />
        Add Gathering
      </Link>
    </Button>
  )
}

function PopupActionsMenu({ popup }: { popup: PopupAdmin }) {
  const [open, setOpen] = useState(false)
  const { data: tenant } = useCurrentTenant()
  const baseUrl = getPortalBaseUrl(tenant)
  const hasPortalLinks = !!baseUrl && !!popup.slug

  if (!hasPortalLinks) return null

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Gathering actions">
          <EllipsisVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a
            href={getPopupPortalUrl(baseUrl, popup.slug)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Open Portal
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href={getPopupCheckoutUrl(baseUrl, popup.slug)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ShoppingCart className="mr-2 h-4 w-4" />
            Open checkout
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—"
  try {
    return format(new Date(dateStr), "MMM d, yyyy")
  } catch {
    return "—"
  }
}

function SaleTypeBadge({ saleType }: { saleType: SaleType | undefined }) {
  if (saleType === "direct") {
    return (
      <Badge
        variant="outline"
        className="border-warning/25 bg-warning-soft text-warning"
      >
        Direct
      </Badge>
    )
  }
  // Default: "application" or undefined (pre-existing popups default to application)
  return <Badge variant="secondary">Application</Badge>
}

const columns: ColumnDef<PopupAdmin>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader label="Name" column={column} />,
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "sale_type",
    header: () => <span>Sale Type</span>,
    cell: ({ row }) => <SaleTypeBadge saleType={row.original.sale_type} />,
  },
  {
    accessorKey: "status",
    header: ({ column }) => <SortableHeader label="Status" column={column} />,
    cell: ({ row }) => (
      <span className="capitalize text-muted-foreground">
        {row.original.status}
      </span>
    ),
  },
  {
    accessorKey: "start_date",
    header: ({ column }) => (
      <SortableHeader label="Start Date" column={column} />
    ),
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {formatDate(row.original.start_date)}
      </span>
    ),
  },
  {
    accessorKey: "end_date",
    header: ({ column }) => <SortableHeader label="End Date" column={column} />,
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {formatDate(row.original.end_date)}
      </span>
    ),
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <PopupActionsMenu popup={row.original} />
      </div>
    ),
  },
]

function PopupsTableContent() {
  const navigate = useNavigate()
  const searchParams = Route.useSearch()
  const { search, pagination, setSearch, setPagination } = useTableSearchParams(
    searchParams,
    "/popups",
  )

  const { data: popups } = useQuery({
    ...getPopupsQueryOptions(pagination.pageIndex, pagination.pageSize, search),
    placeholderData: keepPreviousData,
  })

  if (!popups) return <Skeleton className="h-64 w-full" />

  return (
    <DataTable
      columns={columns}
      data={popups.results}
      searchPlaceholder="Search by name..."
      hiddenOnMobile={["sale_type", "start_date", "end_date"]}
      searchValue={search}
      onSearchChange={setSearch}
      onRowClick={(popup) =>
        navigate({ to: "/popups/$id/edit", params: { id: popup.id } })
      }
      serverPagination={{
        total: popups.paging.total,
        pagination: pagination,
        onPaginationChange: setPagination,
      }}
      emptyState={
        !search ? (
          <EmptyState
            icon={CalendarDays}
            title="No gatherings yet"
            description="Create your first gathering to start managing them."
            action={
              <Button asChild>
                <Link to="/popups/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Gathering
                </Link>
              </Button>
            }
          />
        ) : undefined
      }
    />
  )
}

function PopupsTable() {
  return (
    <QueryErrorBoundary>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <PopupsTableContent />
      </Suspense>
    </QueryErrorBoundary>
  )
}

function Popups() {
  const { isOperatorOrAbove, isSuperadmin } = useAuth()
  const { needsTenantSelection, effectiveTenantId } = useWorkspace()

  const canManagePopups =
    isOperatorOrAbove && (!isSuperadmin || !!effectiveTenantId)

  return (
    <div className="flex flex-col gap-6">
      {needsTenantSelection && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Select an organization</AlertTitle>
          <AlertDescription>
            Please select an organization from the sidebar to view and manage
            gatherings.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Gatherings</h1>
          <p className="text-muted-foreground">
            Manage your gatherings and their configurations
          </p>
        </div>
        {canManagePopups && <AddPopupButton />}
      </div>
      {!needsTenantSelection && <PopupsTable />}
    </div>
  )
}
