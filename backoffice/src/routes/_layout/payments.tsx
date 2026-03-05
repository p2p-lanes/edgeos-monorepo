import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { CreditCard, Download } from "lucide-react"
import { Suspense, useState } from "react"

import { type PaymentPublic, PaymentsService } from "@/client"
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

function getPaymentsQueryOptions(
  popupId: string | null,
  page: number,
  pageSize: number,
) {
  return {
    queryFn: () =>
      PaymentsService.listPayments({
        skip: page * pageSize,
        limit: pageSize,
        popupId: popupId || undefined,
      }),
    queryKey: ["payments", popupId, { page, pageSize }],
  }
}

export const Route = createFileRoute("/_layout/payments")({
  component: Payments,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [{ title: "Payments - EdgeOS" }],
  }),
})

const columns: ColumnDef<PaymentPublic>[] = [
  {
    accessorKey: "amount",
    header: ({ column }) => <SortableHeader label="Amount" column={column} />,
    cell: ({ row }) => (
      <span className="font-mono">
        ${row.original.amount} {row.original.currency}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: ({ column }) => <SortableHeader label="Status" column={column} />,
    cell: ({ row }) => <StatusBadge status={row.original.status ?? ""} />,
  },
  {
    accessorKey: "source",
    header: "Source",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.source || "N/A"}
      </span>
    ),
  },
  {
    accessorKey: "insurance_amount",
    header: "Insurance",
    cell: ({ row }) => {
      const val = row.original.insurance_amount
      const num = Number(val)
      return num > 0 ? (
        <span className="font-mono">${val}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )
    },
  },
  {
    accessorKey: "coupon_code",
    header: "Coupon",
    cell: ({ row }) =>
      row.original.coupon_code ? (
        <Badge variant="outline">{row.original.coupon_code}</Badge>
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
  },
  {
    accessorKey: "created_at",
    header: ({ column }) => <SortableHeader label="Date" column={column} />,
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
  {
    id: "products",
    header: "Products",
    cell: ({ row }) => {
      const products = row.original.products_snapshot
      if (!products || products.length === 0)
        return <span className="text-muted-foreground">—</span>
      return (
        <span className="text-sm">
          {products[0].product_name}
          {products.length > 1 && (
            <span className="text-muted-foreground">
              {" "}
              +{products.length - 1} more
            </span>
          )}
        </span>
      )
    },
  },
]

function PaymentsTableContent() {
  const { selectedPopupId } = useWorkspace()
  const searchParams = Route.useSearch()
  const { search, pagination, setSearch, setPagination } = useTableSearchParams(
    searchParams,
    "/payments",
  )

  const { data: payments } = useQuery({
    ...getPaymentsQueryOptions(
      selectedPopupId,
      pagination.pageIndex,
      pagination.pageSize,
    ),
    placeholderData: keepPreviousData,
  })

  if (!payments) return <Skeleton className="h-64 w-full" />

  const filtered = search
    ? payments.results.filter((p) => {
        const term = search.toLowerCase()
        return (
          (p.status ?? "").toLowerCase().includes(term) ||
          (p.source ?? "").toLowerCase().includes(term) ||
          (p.coupon_code ?? "").toLowerCase().includes(term) ||
          String(p.amount).includes(term)
        )
      })
    : payments.results

  return (
    <DataTable
      columns={columns}
      data={filtered}
      searchPlaceholder="Search by status, source, coupon, or amount..."
      hiddenOnMobile={[
        "source",
        "insurance_amount",
        "coupon_code",
        "created_at",
        "products",
      ]}
      searchValue={search}
      onSearchChange={setSearch}
      serverPagination={{
        total: search ? filtered.length : payments.paging.total,
        pagination: search
          ? { pageIndex: 0, pageSize: payments.paging.total }
          : pagination,
        onPaginationChange: setPagination,
      }}
      emptyState={
        !search ? (
          <EmptyState
            icon={CreditCard}
            title="No payments yet"
            description="Payment transactions will appear here once attendees start purchasing products."
          />
        ) : undefined
      }
    />
  )
}

function Payments() {
  const { isContextReady, selectedPopupId } = useWorkspace()
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    if (!selectedPopupId) return
    setIsExporting(true)
    try {
      const results = await fetchAllPages((skip, limit) =>
        PaymentsService.listPayments({
          skip,
          limit,
          popupId: selectedPopupId,
        }),
      )
      exportToCsv("payments", results as unknown as Record<string, unknown>[], [
        { key: "amount", label: "Amount" },
        { key: "currency", label: "Currency" },
        { key: "status", label: "Status" },
        { key: "source", label: "Source" },
        { key: "insurance_amount", label: "Insurance" },
        { key: "coupon_code", label: "Coupon" },
        { key: "created_at", label: "Date" },
      ])
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
          <p className="text-muted-foreground">
            Track and manage payment transactions
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
        <WorkspaceAlert resource="payments" />
      ) : (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <PaymentsTableContent />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
