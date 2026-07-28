import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import type { ColumnDef, Row } from "@tanstack/react-table"
import {
  ChevronDown,
  ChevronRight,
  CreditCard,
  Download,
  FileText,
  Loader2,
  X,
} from "lucide-react"
import { Fragment, Suspense, useCallback, useMemo, useState } from "react"
import { toast } from "sonner"

import {
  OpenAPI,
  type PaymentPublic,
  type PaymentSource,
  type PaymentStatus,
  PaymentsService,
  PopupsService,
} from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import {
  FilterBuilder,
  type FilterCondition,
  type FilterFieldDef,
  type FilterMatch,
  isCompleteCondition,
  sanitizeFilterConditions,
} from "@/components/Common/FilterBuilder"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { SavedViewsMenu } from "@/components/Common/SavedViewsMenu"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import {
  type TableSearchParams,
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import { exportToCsv, fetchAllPages } from "@/lib/export"

import {
  buildPaymentsQueryConfig,
  buildPaymentsTableState,
  getRailAdjustment,
  resolveLineUnitPrice,
} from "./payments.helpers"

function getPaymentsQueryOptions(
  popupId: string | null,
  page: number,
  pageSize: number,
  search: string,
  filters?: string,
  sortBy?: string,
  sortOrder?: "asc" | "desc",
  applicationId?: string | null,
) {
  const queryConfig = buildPaymentsQueryConfig({
    popupId,
    page,
    pageSize,
    search,
    filters,
    sortBy,
    sortOrder,
    applicationId,
  })

  return {
    queryFn: () => PaymentsService.listPayments(queryConfig.params),
    queryKey: queryConfig.queryKey,
  }
}

const PAYMENT_STATUS_OPTIONS: { value: PaymentStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
]

const PAYMENT_SOURCE_OPTIONS: { value: PaymentSource; label: string }[] = [
  { value: "SimpleFI", label: "SimpleFI" },
  { value: "Stripe", label: "Stripe" },
  { value: "MercadoPago", label: "MercadoPago" },
  { value: "Crypto", label: "Crypto" },
]

const PAYMENT_TYPE_OPTIONS = [
  { value: "pass_purchase", label: "Pass purchase" },
  { value: "application_fee", label: "Application fee" },
]

const AMOUNT_OPS = ["eq", "gt", "gte", "lt", "lte"]
const PAYMENT_DATE_OPS = ["before", "after"]

const PAYMENT_FIELD_DEFS: FilterFieldDef[] = [
  {
    key: "status",
    label: "Status",
    kind: "select",
    ops: ["eq", "neq"],
    options: PAYMENT_STATUS_OPTIONS,
  },
  {
    key: "source",
    label: "Source",
    kind: "select",
    ops: ["eq", "neq"],
    options: PAYMENT_SOURCE_OPTIONS,
  },
  {
    key: "payment_type",
    label: "Type",
    kind: "select",
    ops: ["eq", "neq"],
    options: PAYMENT_TYPE_OPTIONS,
  },
  { key: "currency", label: "Currency", kind: "text", ops: ["eq", "neq"] },
  { key: "amount", label: "Amount", kind: "number", ops: AMOUNT_OPS },
  {
    key: "amount_charged",
    label: "Charged",
    kind: "number",
    ops: [...AMOUNT_OPS, "is_empty", "not_empty"],
  },
  { key: "created_at", label: "Date", kind: "date", ops: PAYMENT_DATE_OPS },
]

const VALID_PAYMENT_STATUSES: Set<string> = new Set([
  "pending",
  "approved",
  "rejected",
  "expired",
  "cancelled",
])

type PaymentsSearchParams = TableSearchParams & {
  match?: FilterMatch
  filters?: FilterCondition[]
  applicationId?: string
}

export const Route = createFileRoute("/_layout/payments")({
  component: Payments,
  validateSearch: (raw: Record<string, unknown>): PaymentsSearchParams => {
    const filters = sanitizeFilterConditions(raw.filters)
    // Legacy ?status= links fold into the filter conditions.
    if (
      typeof raw.status === "string" &&
      VALID_PAYMENT_STATUSES.has(raw.status) &&
      !filters.some((condition) => condition.field === "status")
    ) {
      filters.push({ field: "status", op: "eq", value: raw.status })
    }
    return {
      ...validateTableSearch(raw),
      ...(raw.match === "any" && filters.length
        ? { match: "any" as const }
        : {}),
      ...(filters.length ? { filters } : {}),
      ...(typeof raw.applicationId === "string" && raw.applicationId
        ? { applicationId: raw.applicationId }
        : {}),
    }
  },
  head: () => ({
    meta: [{ title: "Payments - EdgeOS" }],
  }),
})

// Single source for the filter-related search params, shared by the table
// and the CSV export so both always query the same subset.
function usePaymentsFilterParams() {
  const searchParams = Route.useSearch()
  const filterMatch = searchParams.match ?? "all"
  const filterConditions = useMemo(
    () => searchParams.filters ?? [],
    [searchParams.filters],
  )
  const filtersJson = useMemo(() => {
    const complete = filterConditions.filter(isCompleteCondition)
    return complete.length
      ? JSON.stringify({ match: filterMatch, conditions: complete })
      : undefined
  }, [filterConditions, filterMatch])
  return {
    search: searchParams.search ?? "",
    filterMatch,
    filterConditions,
    filtersJson,
  }
}

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
      id: "buyer",
      header: "Buyer",
      cell: ({ row }) => {
        const email = row.original.buyer_email
        const name = row.original.buyer_name
        if (!email && !name)
          return <span className="text-muted-foreground">—</span>
        return (
          <div className="flex flex-col">
            <span className="font-medium">{email ?? name}</span>
            {email && name ? (
              <span className="text-xs text-muted-foreground">{name}</span>
            ) : null}
          </div>
        )
      },
    },
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
      accessorKey: "amount_charged",
      header: ({ column }) => (
        <SortableHeader label="Charged" column={column} />
      ),
      cell: ({ row }) => {
        // Settled total from SimpleFi — differs from Amount when the merchant
        // applies a per-rail (card/crypto) discount or surcharge. NULL until
        // settlement and for non-SimpleFi payments.
        const val = row.original.amount_charged
        if (val == null) {
          return <span className="text-muted-foreground">—</span>
        }
        // In-flight installment plans accumulate per settlement, so this is
        // what's been collected so far, not the final adjusted total.
        const adj = getRailAdjustment(row.original)
        const showReason = adj?.final && Math.abs(adj.delta) > 0.01
        return (
          <div className="flex flex-col">
            <span className="font-mono">
              ${val} {row.original.currency}
              {adj && !adj.final ? (
                <span className="font-sans text-xs text-muted-foreground">
                  {" "}
                  so far
                </span>
              ) : null}
            </span>
            {showReason && adj ? (
              <span
                className={`text-xs ${adj.isDiscount ? "text-success" : "text-warning"}`}
              >
                adjustment {adj.isDiscount ? "−" : "+"}
                {adj.pct}%
              </span>
            ) : null}
          </div>
        )
      },
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
      id: "installments",
      header: "Installments",
      cell: ({ row }) => {
        // Render the badge only once SimpleFi's installment_plan_activated
        // webhook has filled in installments_total. While the plan is still
        // PENDING (buyer hasn't picked a cycle count), we show em-dash to
        // match the other "no value yet" columns. A single-installment plan
        // is effectively pay-in-full, so we also show em-dash there — the
        // badge is reserved for genuine multi-cycle plans (total >= 2).
        const total = row.original.installments_total
        if (!row.original.is_installment_plan || total == null || total < 2) {
          return <span className="text-muted-foreground">—</span>
        }
        const paid = row.original.installments_paid ?? 0
        return (
          <Badge variant="secondary" className="font-mono">
            {paid}/{total}
          </Badge>
        )
      },
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
      accessorKey: "contribution_amount",
      header: "Contribution",
      cell: ({ row }) => {
        const val = row.original.contribution_amount
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
    (sum, p) => sum + resolveLineUnitPrice(p) * p.quantity,
    0,
  )
  const total = Number(payment.amount)
  const insuranceAmount = Number(payment.insurance_amount ?? 0)
  const contributionAmount = Number(payment.contribution_amount ?? 0)
  const discountAmount = subtotal + insuranceAmount + contributionAmount - total
  const hasDiscount = discountAmount > 0.01
  const hasInsurance = insuranceAmount > 0.01
  const hasContribution = contributionAmount > 0.01
  const hasBreakdown = hasDiscount || hasInsurance || hasContribution

  const railAdj = getRailAdjustment(payment)

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
            <th className="pb-2 text-left font-medium">Attendee</th>
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
              {items.map((item, i) => {
                const unitPrice = resolveLineUnitPrice(item)
                const lineTotal = unitPrice * item.quantity
                return (
                  <tr
                    key={`${attendeeId}-${item.product_name}-${i}`}
                    className={`border-b border-border/40 last:border-0 ${i === 0 && groupIdx > 0 ? "border-t border-border/60" : ""}`}
                  >
                    {i === 0 ? (
                      <td
                        rowSpan={items.length}
                        className="py-1.5 pr-4 align-top text-xs font-semibold tracking-wide text-muted-foreground"
                      >
                        {name}
                      </td>
                    ) : null}
                    <td className="py-1.5 pr-4">{item.product_name}</td>
                    <td className="py-1.5 pr-4 text-muted-foreground">
                      {categoryLabels[item.product_category] ??
                        item.product_category}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {item.quantity}
                    </td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                      ${unitPrice}
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
          {hasBreakdown && (
            <tr className="border-t border-border/40">
              <td colSpan={5} className="pt-2 text-right text-muted-foreground">
                Subtotal
              </td>
              <td className="pt-2 pl-4 text-right font-mono tabular-nums text-muted-foreground">
                ${subtotal.toFixed(2)}
              </td>
            </tr>
          )}
          {hasDiscount && (
            <tr>
              <td
                colSpan={5}
                className="py-0.5 text-right text-muted-foreground"
              >
                {discountLabel}
              </td>
              <td className="py-0.5 pl-4 text-right font-mono tabular-nums text-success">
                -${discountAmount.toFixed(2)}
              </td>
            </tr>
          )}
          {hasInsurance && (
            <tr>
              <td
                colSpan={5}
                className="py-0.5 text-right text-muted-foreground"
              >
                Insurance
              </td>
              <td className="py-0.5 pl-4 text-right font-mono tabular-nums">
                +${insuranceAmount.toFixed(2)}
              </td>
            </tr>
          )}
          {hasContribution && (
            <tr>
              <td
                colSpan={5}
                className="py-0.5 text-right text-muted-foreground"
              >
                Contribution
              </td>
              <td className="py-0.5 pl-4 text-right font-mono tabular-nums">
                +${contributionAmount.toFixed(2)}
              </td>
            </tr>
          )}
          <tr className={hasBreakdown ? "" : "border-t border-border/40"}>
            <td colSpan={5} className="pt-1.5 text-right font-semibold">
              Total
            </td>
            <td className="pt-1.5 pl-4 text-right font-mono font-semibold tabular-nums">
              ${total.toFixed(2)} {payment.currency}
            </td>
          </tr>
          {railAdj?.final && Math.abs(railAdj.delta) > 0.01 ? (
            <>
              <tr>
                <td
                  colSpan={5}
                  className="py-0.5 text-right text-muted-foreground"
                >
                  Adjustment ({railAdj.isDiscount ? "−" : "+"}
                  {railAdj.pct}%)
                </td>
                <td
                  className={`py-0.5 pl-4 text-right font-mono tabular-nums ${railAdj.isDiscount ? "text-success" : "text-warning"}`}
                >
                  {railAdj.isDiscount ? "−" : "+"}$
                  {Math.abs(railAdj.delta).toFixed(2)}
                </td>
              </tr>
              <tr>
                <td colSpan={5} className="pt-0.5 text-right font-semibold">
                  Charged
                </td>
                <td className="pt-0.5 pl-4 text-right font-mono font-semibold tabular-nums">
                  ${Number(payment.amount_charged).toFixed(2)}{" "}
                  {payment.currency}
                </td>
              </tr>
            </>
          ) : null}
          {railAdj && !railAdj.final ? (
            <tr>
              <td
                colSpan={5}
                className="py-0.5 text-right text-muted-foreground"
              >
                Collected so far ({payment.installments_paid ?? 0}/
                {payment.installments_total} installments)
              </td>
              <td className="py-0.5 pl-4 text-right font-mono tabular-nums text-muted-foreground">
                ${Number(payment.amount_charged).toFixed(2)} {payment.currency}
              </td>
            </tr>
          ) : null}
        </tfoot>
      </table>
    </div>
  )
}

function PaymentsTableContent() {
  const { selectedPopupId } = useWorkspace()
  const navigate = useNavigate()
  const searchParams = Route.useSearch()
  const { search, pagination, sorting, setSearch, setPagination, setSorting } =
    useTableSearchParams(searchParams, "/payments")
  const { filterMatch, filterConditions, filtersJson } =
    usePaymentsFilterParams()
  const applicationId = searchParams.applicationId

  const setFilters = useCallback(
    (match: FilterMatch, conditions: FilterCondition[]) => {
      navigate({
        to: "/payments",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          // Scrub the legacy param so validateSearch cannot fold it back
          // into a resurrected condition after the user edits the filters.
          status: undefined,
          match:
            match === "any" && conditions.length ? ("any" as const) : undefined,
          filters: conditions.length ? conditions : undefined,
          page: 0,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  const hasActiveView = Boolean(
    filterConditions.length || search || searchParams.sortBy,
  )

  const clearView = useCallback(() => {
    navigate({
      to: "/payments",
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        status: undefined,
        match: undefined,
        filters: undefined,
        search: undefined,
        sortBy: undefined,
        sortOrder: undefined,
        page: 0,
      }),
      replace: true,
    })
  }, [navigate])

  const savedViewConfig = useMemo(() => {
    const config: Record<string, unknown> = {}
    if (filterMatch === "any" && filterConditions.length) config.match = "any"
    if (filterConditions.length) config.filters = filterConditions
    if (search) config.search = search
    if (searchParams.sortBy) {
      config.sortBy = searchParams.sortBy
      config.sortOrder = searchParams.sortOrder
    }
    return config
  }, [
    filterMatch,
    filterConditions,
    search,
    searchParams.sortBy,
    searchParams.sortOrder,
  ])

  const applySavedView = useCallback(
    (config: Record<string, unknown>) => {
      const filters = sanitizeFilterConditions(config.filters)
      const sortOrder: "asc" | "desc" | undefined =
        config.sortOrder === "asc" || config.sortOrder === "desc"
          ? config.sortOrder
          : undefined
      navigate({
        to: "/payments",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          status: undefined,
          page: 0,
          match:
            config.match === "any" && filters.length
              ? ("any" as const)
              : undefined,
          filters: filters.length ? filters : undefined,
          search:
            typeof config.search === "string" && config.search
              ? config.search
              : undefined,
          sortBy:
            typeof config.sortBy === "string" && config.sortBy
              ? config.sortBy
              : undefined,
          sortOrder,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  const { data: payments } = useQuery({
    ...getPaymentsQueryOptions(
      selectedPopupId,
      pagination.pageIndex,
      pagination.pageSize,
      search,
      filtersJson,
      sorting[0]?.id,
      sorting[0]?.desc ? "desc" : "asc",
      applicationId,
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

  const tableState = buildPaymentsTableState({ payments, pagination })

  return (
    <DataTable
      columns={columns}
      data={tableState.data}
      searchPlaceholder="Search by external ID, attendee email, or attendee name..."
      hiddenOnMobile={[
        "source",
        "amount_charged",
        "installments",
        "insurance_amount",
        "contribution_amount",
        "coupon_code",
        "created_at",
        "products",
        "invoice",
      ]}
      searchValue={search}
      onSearchChange={setSearch}
      serverSorting={{
        sorting,
        onSortingChange: setSorting,
      }}
      serverPagination={{
        ...tableState.serverPagination,
        onPaginationChange: setPagination,
      }}
      filterBar={
        <div className="flex flex-wrap items-center gap-2">
          <FilterBuilder
            fields={PAYMENT_FIELD_DEFS}
            match={filterMatch}
            conditions={filterConditions}
            onChange={setFilters}
            emptyMessage="No filters applied. Add a filter to narrow down payments."
          />
          {selectedPopupId && (
            <SavedViewsMenu
              popupId={selectedPopupId}
              entity="payments"
              currentConfig={savedViewConfig}
              onApply={applySavedView}
            />
          )}
          {hasActiveView && (
            <Button
              variant="ghost"
              className="h-9 text-muted-foreground"
              onClick={clearView}
            >
              <X className="h-4 w-4" />
              Clear
            </Button>
          )}
          {applicationId && (
            <Badge variant="secondary" className="gap-1 py-1 pl-2.5 pr-1">
              Application
              <button
                type="button"
                aria-label="Clear application filter"
                onClick={() =>
                  navigate({
                    to: "/payments",
                    search: {
                      ...searchParams,
                      applicationId: undefined,
                      page: 0,
                    },
                    replace: true,
                  })
                }
                className="rounded-sm p-0.5 transition-colors hover:bg-foreground/10"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
        </div>
      }
      renderSubComponent={PaymentSubRow}
      emptyState={
        !search && !filterConditions.length ? (
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
  const searchParams = Route.useSearch()
  const { search, filtersJson } = usePaymentsFilterParams()
  const [isExporting, setIsExporting] = useState(false)

  // Export what the table shows: the same search, filters and sort drive the
  // fetch, just without pagination.
  const isExportFiltered = Boolean(search || filtersJson)
  const handleExport = async () => {
    if (!selectedPopupId) return
    setIsExporting(true)
    try {
      const results = await fetchAllPages((skip, limit) =>
        PaymentsService.listPayments({
          skip,
          limit,
          popupId: selectedPopupId,
          search: search.trim() || undefined,
          filters: filtersJson,
          sortBy: searchParams.sortBy || undefined,
          sortOrder: searchParams.sortBy
            ? (searchParams.sortOrder ?? "desc")
            : undefined,
        }),
      )
      exportToCsv(
        isExportFiltered ? "payments-filtered" : "payments",
        results as unknown as Record<string, unknown>[],
        [
          { key: "amount", label: "Amount" },
          { key: "currency", label: "Currency" },
          { key: "status", label: "Status" },
          { key: "source", label: "Source" },
          { key: "is_installment_plan", label: "Installment Plan" },
          { key: "installments_paid", label: "Installments Paid" },
          { key: "installments_total", label: "Installments Total" },
          { key: "insurance_amount", label: "Insurance" },
          { key: "contribution_amount", label: "Contribution" },
          { key: "coupon_code", label: "Coupon" },
          { key: "created_at", label: "Date", type: "date" },
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
            title={
              isExportFiltered
                ? "Exports the payments matching the current filters"
                : "Exports all payments for this gathering"
            }
          >
            <Download className="mr-2 h-4 w-4" />
            {isExporting
              ? "Exporting..."
              : isExportFiltered
                ? "Export filtered CSV"
                : "Export CSV"}
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
