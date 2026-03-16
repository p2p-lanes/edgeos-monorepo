import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { Download, ShoppingCart } from "lucide-react"
import { Suspense, useState } from "react"

import { type AbandonedCartPublic, CartsService } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import { exportToCsv, fetchAllPages } from "@/lib/export"

function getAbandonedCartsQueryOptions(
  popupId: string | null,
  page: number,
  pageSize: number,
) {
  return {
    queryFn: () =>
      CartsService.listAbandonedCarts({
        skip: page * pageSize,
        limit: pageSize,
        popupId: popupId || undefined,
      }),
    queryKey: ["abandoned-carts", popupId, { page, pageSize }],
  }
}

export const Route = createFileRoute("/_layout/abandoned-carts")({
  component: AbandonedCarts,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [{ title: "Abandoned Carts - EdgeOS" }],
  }),
})

function formatName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return [firstName, lastName].filter(Boolean).join(" ") || "—"
}

function getCartItemCount(items: AbandonedCartPublic["items"]): number {
  let count = 0
  count += items.passes?.length ?? 0
  count += items.housing ? 1 : 0
  count += items.merch?.length ?? 0
  count += items.patron ? 1 : 0
  return count
}

const columns: ColumnDef<AbandonedCartPublic>[] = [
  {
    id: "human_name",
    header: ({ column }) => <SortableHeader label="Name" column={column} />,
    cell: ({ row }) => (
      <span className="font-medium">
        {formatName(
          row.original.human.first_name,
          row.original.human.last_name,
        )}
      </span>
    ),
  },
  {
    id: "human_email",
    header: ({ column }) => <SortableHeader label="Email" column={column} />,
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.human.email}</span>
    ),
  },
  {
    id: "popup_name",
    header: "Event",
    cell: ({ row }) => <span>{row.original.popup.name}</span>,
  },
  {
    id: "cart_items",
    header: "Items",
    cell: ({ row }) => {
      const count = getCartItemCount(row.original.items)
      return (
        <Badge variant="secondary">
          {count} {count === 1 ? "item" : "items"}
        </Badge>
      )
    },
  },
  {
    id: "payment_attempts",
    header: "Payment Attempts",
    cell: ({ row }) => {
      const payments = row.original.payments ?? []
      if (payments.length === 0)
        return <span className="text-muted-foreground">None</span>
      return (
        <div className="flex flex-col gap-1">
          {payments.slice(0, 2).map((p) => (
            <Link
              key={p.id}
              to="/payments"
              search={{ search: p.id }}
              className="flex items-center gap-2 rounded px-1 -mx-1 transition-colors hover:bg-muted"
            >
              <StatusBadge status={p.status} />
              <span className="font-mono text-xs">
                ${p.amount} {p.currency}
              </span>
            </Link>
          ))}
          {payments.length > 2 && (
            <span className="text-muted-foreground text-xs">
              +{payments.length - 2} more
            </span>
          )}
        </div>
      )
    },
  },
  {
    accessorKey: "updated_at",
    header: ({ column }) => (
      <SortableHeader label="Last Activity" column={column} />
    ),
    cell: ({ row }) => {
      const date = row.original.updated_at
      if (!date) return <span className="text-muted-foreground">N/A</span>
      return (
        <span className="text-muted-foreground">
          {new Intl.DateTimeFormat("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(date))}
        </span>
      )
    },
  },
  {
    accessorKey: "created_at",
    header: ({ column }) => <SortableHeader label="Created" column={column} />,
    cell: ({ row }) => {
      const date = row.original.created_at
      if (!date) return <span className="text-muted-foreground">N/A</span>
      return (
        <span className="text-muted-foreground">
          {new Intl.DateTimeFormat("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(date))}
        </span>
      )
    },
  },
]

function AbandonedCartsTableContent() {
  const { selectedPopupId } = useWorkspace()
  const searchParams = Route.useSearch()
  const { search, pagination, setSearch, setPagination } = useTableSearchParams(
    searchParams,
    "/abandoned-carts",
  )

  const { data: carts } = useQuery({
    ...getAbandonedCartsQueryOptions(
      selectedPopupId,
      pagination.pageIndex,
      pagination.pageSize,
    ),
    placeholderData: keepPreviousData,
  })

  if (!carts) return <Skeleton className="h-64 w-full" />

  const filtered = search
    ? carts.results.filter((c) => {
        const term = search.toLowerCase()
        return (
          c.human.email.toLowerCase().includes(term) ||
          (c.human.first_name ?? "").toLowerCase().includes(term) ||
          (c.human.last_name ?? "").toLowerCase().includes(term) ||
          c.popup.name.toLowerCase().includes(term)
        )
      })
    : carts.results

  return (
    <DataTable
      columns={columns}
      data={filtered}
      searchPlaceholder="Search by name, email, or event..."
      hiddenOnMobile={[
        "human_email",
        "popup_name",
        "payment_attempts",
        "created_at",
      ]}
      searchValue={search}
      onSearchChange={setSearch}
      serverPagination={{
        total: search ? filtered.length : carts.paging.total,
        pagination: search
          ? { pageIndex: 0, pageSize: carts.paging.total }
          : pagination,
        onPaginationChange: setPagination,
      }}
      emptyState={
        !search ? (
          <EmptyState
            icon={ShoppingCart}
            title="No abandoned carts"
            description="Abandoned carts will appear here when users add items but don't complete checkout."
          />
        ) : undefined
      }
    />
  )
}

function AbandonedCarts() {
  const { isContextReady, selectedPopupId } = useWorkspace()
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    if (!selectedPopupId) return
    setIsExporting(true)
    try {
      const results = await fetchAllPages((skip, limit) =>
        CartsService.listAbandonedCarts({
          skip,
          limit,
          popupId: selectedPopupId,
        }),
      )
      exportToCsv(
        "abandoned-carts",
        results.map((c) => ({
          name: formatName(c.human.first_name, c.human.last_name),
          email: c.human.email,
          event: c.popup.name,
          items: getCartItemCount(c.items),
          payment_attempts: (c.payments ?? []).length,
          last_activity: c.updated_at,
          created: c.created_at,
        })) as unknown as Record<string, unknown>[],
        [
          { key: "name", label: "Name" },
          { key: "email", label: "Email" },
          { key: "event", label: "Event" },
          { key: "items", label: "Items" },
          { key: "payment_attempts", label: "Payment Attempts" },
          { key: "last_activity", label: "Last Activity", type: "date" },
          { key: "created", label: "Created", type: "date" },
        ],
      )
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Abandoned Carts</h1>
          <p className="text-muted-foreground">
            Track carts that haven't completed checkout
          </p>
        </div>
        {isContextReady && (
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={isExporting}
          >
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? "Exporting..." : "Export CSV"}
          </Button>
        )}
      </div>
      {!isContextReady ? (
        <WorkspaceAlert resource="abandoned carts" />
      ) : (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <AbandonedCartsTableContent />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
