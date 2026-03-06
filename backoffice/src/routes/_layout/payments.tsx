import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { ColumnDef, Row } from "@tanstack/react-table"
import { ChevronDown, ChevronRight, CreditCard, Download } from "lucide-react"
import { Fragment, Suspense, useState } from "react"

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
      const isExpanded = row.getIsExpanded()
      return (
        <button
          type="button"
          className="flex items-center gap-1.5 text-sm"
          onClick={(e) => {
            e.stopPropagation()
            row.toggleExpanded()
          }}
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <Badge variant="secondary">
            {products.length} {products.length === 1 ? "product" : "products"}
          </Badge>
        </button>
      )
    },
  },
]

const categoryLabels: Record<string, string> = {
  ticket: "Pass",
  housing: "Housing",
  merch: "Merch",
  patreon: "Patron",
}

function PaymentSubRow({ row }: { row: Row<PaymentPublic> }) {
  const products = row.original.products_snapshot ?? []

  const byAttendee = products.reduce<
    Record<string, { name: string; items: (typeof products)[number][] }>
  >((acc, p) => {
    const key = p.attendee_id
    if (!acc[key]) {
      acc[key] = { name: p.attendee_name || "Unknown", items: [] }
    }
    acc[key].items.push(p)
    return acc
  }, {})

  const entries = Object.entries(byAttendee)

  return (
    <div className="border-l-2 border-primary/20 bg-muted/20 py-3 pl-6 pr-4">
      <table className="w-full">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="pb-2 text-left font-medium">Product</th>
            <th className="pb-2 text-left font-medium">Type</th>
            <th className="pb-2 text-right font-medium">Qty</th>
            <th className="pb-2 text-right font-medium">Unit Price</th>
            <th className="pb-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody className="text-sm">
          {entries.map(([attendeeId, { name, items }], groupIdx) => (
            <Fragment key={attendeeId}>
              <tr>
                <td
                  colSpan={5}
                  className={`pb-1 text-xs font-semibold tracking-wide text-muted-foreground ${groupIdx > 0 ? "pt-3" : ""}`}
                >
                  {name}
                </td>
              </tr>
              {items.map((item, i) => {
                const lineTotal = Number(item.product_price) * item.quantity
                return (
                  <tr
                    key={`${attendeeId}-${item.product_name}-${i}`}
                    className="border-b border-border/40 last:border-0"
                  >
                    <td className="py-1.5 pr-4">{item.product_name}</td>
                    <td className="py-1.5 pr-4 text-muted-foreground">
                      {categoryLabels[item.product_category] ??
                        item.product_category}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {item.quantity}
                    </td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                      ${Number(item.product_price)}
                    </td>
                    <td className="py-1.5 pl-4 text-right font-mono tabular-nums">
                      ${lineTotal}
                    </td>
                  </tr>
                )
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

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
          p.id.toLowerCase().includes(term) ||
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
      renderSubComponent={PaymentSubRow}
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
