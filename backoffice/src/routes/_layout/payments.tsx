import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { ColumnDef, Row } from "@tanstack/react-table"
import {
  ChevronDown,
  ChevronRight,
  CreditCard,
  Download,
  FileText,
  Loader2,
} from "lucide-react"
import { Fragment, Suspense, useCallback, useState } from "react"
import { toast } from "sonner"

import {
  OpenAPI,
  type PaymentPublic,
  PaymentsService,
  PopupsService,
} from "@/client"
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

async function downloadInvoicePdf(paymentId: string): Promise<void> {
  const token =
    typeof OpenAPI.TOKEN === "function"
      ? await OpenAPI.TOKEN({ method: "GET", url: "" })
      : OpenAPI.TOKEN
  const tenantId = localStorage.getItem("workspace_tenant_id")

  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (tenantId) headers["X-Tenant-Id"] = tenantId

  const response = await fetch(
    `${OpenAPI.BASE}/api/v1/payments/${paymentId}/invoice`,
    { headers },
  )

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Invoice not available for this payment")
    }
    throw new Error(`HTTP ${response.status}`)
  }

  const blob = await response.blob()
  const blobUrl = window.URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = blobUrl
  link.download = `invoice-${paymentId}.pdf`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(blobUrl)
}

function InvoiceButton({ paymentId }: { paymentId: string }) {
  const [isLoading, setIsLoading] = useState(false)

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      setIsLoading(true)
      try {
        await downloadInvoicePdf(paymentId)
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Download failed"
        toast.error(message)
      } finally {
        setIsLoading(false)
      }
    },
    [paymentId],
  )

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      disabled={isLoading}
      onClick={handleClick}
      title="Download invoice PDF"
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <FileText className="h-4 w-4" />
      )}
    </Button>
  )
}

function getColumns(hasInvoice: boolean): ColumnDef<PaymentPublic>[] {
  const cols: ColumnDef<PaymentPublic>[] = [
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

  if (hasInvoice) {
    cols.push({
      id: "invoice",
      header: "Invoice",
      cell: ({ row }) => {
        if (row.original.status !== "approved") return null
        if (Number(row.original.amount) <= 0) return null
        return <InvoiceButton paymentId={row.original.id} />
      },
    })
  }

  return cols
}

const categoryLabels: Record<string, string> = {
  ticket: "Pass",
  housing: "Housing",
  merch: "Merch",
  patreon: "Patron",
}

function PaymentSubRow({ row }: { row: Row<PaymentPublic> }) {
  const payment = row.original
  const products = payment.products_snapshot ?? []

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
  const subtotal = products.reduce(
    (sum, p) => sum + Number(p.product_price) * p.quantity,
    0,
  )
  const total = Number(payment.amount)
  const discountAmount = subtotal - total
  const hasDiscount = discountAmount > 0.01

  let discountLabel = "Discount"
  if (payment.coupon_code) {
    discountLabel = `Discount (coupon: ${payment.coupon_code})`
  } else if (payment.group_id && Number(payment.discount_value ?? 0) > 0) {
    discountLabel = `Discount (group ${Number(payment.discount_value)}%)`
  } else if (Number(payment.discount_value ?? 0) > 0) {
    discountLabel = `Discount (${Number(payment.discount_value)}%)`
  }

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
        <tfoot className="text-sm">
          {hasDiscount && (
            <>
              <tr className="border-t border-border/40">
                <td
                  colSpan={4}
                  className="pt-2 text-right text-muted-foreground"
                >
                  Subtotal
                </td>
                <td className="pt-2 pl-4 text-right font-mono tabular-nums text-muted-foreground">
                  ${subtotal.toFixed(2)}
                </td>
              </tr>
              <tr>
                <td
                  colSpan={4}
                  className="py-0.5 text-right text-muted-foreground"
                >
                  {discountLabel}
                </td>
                <td className="py-0.5 pl-4 text-right font-mono tabular-nums text-green-600">
                  -${discountAmount.toFixed(2)}
                </td>
              </tr>
            </>
          )}
          <tr className={hasDiscount ? "" : "border-t border-border/40"}>
            <td colSpan={4} className="pt-1.5 text-right font-semibold">
              Total
            </td>
            <td className="pt-1.5 pl-4 text-right font-mono font-semibold tabular-nums">
              ${total.toFixed(2)} {payment.currency}
            </td>
          </tr>
        </tfoot>
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

  const { data: popup } = useQuery({
    queryKey: ["popups", selectedPopupId],
    queryFn: () =>
      PopupsService.getPopup({ popupId: selectedPopupId as string }),
    enabled: !!selectedPopupId,
  })

  const hasInvoice = !!(
    popup?.invoice_company_name &&
    popup?.invoice_company_address &&
    popup?.invoice_company_email
  )

  const columns = getColumns(hasInvoice)

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
        "invoice",
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
        { key: "created_at", label: "Date", type: "date" },
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
