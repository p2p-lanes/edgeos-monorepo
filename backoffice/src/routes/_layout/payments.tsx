import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import {
  Check,
  Copy,
  CreditCard,
  Download,
  EllipsisVertical,
  ExternalLink,
  Eye,
} from "lucide-react"
import { Suspense, useState } from "react"

import { type ApiError, type PaymentPublic, PaymentsService } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { StatusBadge } from "@/components/Common/StatusBadge"
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard"
import useCustomToast from "@/hooks/useCustomToast"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import { exportToCsv, fetchAllPages } from "@/lib/export"
import { createErrorHandler } from "@/utils"

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

function ViewPayment({ payment }: { payment: PaymentPublic }) {
  const [isOpen, setIsOpen] = useState(false)
  const [, copy] = useCopyToClipboard()
  const { showSuccessToast } = useCustomToast()

  const copyToClipboard = (text: string, label: string) => {
    copy(text)
    showSuccessToast(`${label} copied to clipboard`)
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuItem
        onSelect={(e) => e.preventDefault()}
        onClick={() => setIsOpen(true)}
      >
        <Eye className="mr-2 h-4 w-4" />
        View Details
      </DropdownMenuItem>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Payment Details</DialogTitle>
          <DialogDescription>
            Payment ID: {payment.id.slice(0, 8)}...
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Amount
              </p>
              <p className="text-lg font-bold font-mono">
                ${payment.amount} {payment.currency}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Status
              </p>
              <StatusBadge status={payment.status ?? ""} />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Source
              </p>
              <p>{payment.source || "N/A"}</p>
            </div>
            {payment.rate && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Rate
                </p>
                <p>{payment.rate}</p>
              </div>
            )}
          </div>

          {payment.coupon_code && (
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium text-muted-foreground">
                Coupon Applied
              </p>
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="mt-1">
                  {payment.coupon_code}
                </Badge>
                {payment.discount_value && (
                  <span className="text-sm text-green-600">
                    -{payment.discount_value}%
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Payment ID
                </p>
                <p className="font-mono text-sm">{payment.id}</p>
              </div>
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy Payment ID"
                onClick={() => copyToClipboard(payment.id, "Payment ID")}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {payment.external_id && (
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    External ID
                  </p>
                  <p className="font-mono text-sm">{payment.external_id}</p>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copy External ID"
                  onClick={() =>
                    copyToClipboard(payment.external_id!, "External ID")
                  }
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {payment.checkout_url && (
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">
                Checkout URL
              </p>
              <a
                href={payment.checkout_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline text-sm break-all"
              >
                {payment.checkout_url.slice(0, 50)}...
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          {payment.products_snapshot &&
            payment.products_snapshot.length > 0 && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-2">
                  Products
                </p>
                <div className="space-y-2">
                  {payment.products_snapshot.map((product) => (
                    <div
                      key={`${product.product_id}-${product.attendee_id}`}
                      className="flex items-center justify-between rounded border p-2"
                    >
                      <span className="text-sm">{product.product_name}</span>
                      <span className="font-mono text-sm">
                        {product.quantity}x ${product.product_price}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground">
            {payment.created_at && (
              <div>
                Created: {new Date(payment.created_at).toLocaleString()}
              </div>
            )}
            {payment.updated_at && (
              <div>
                Updated: {new Date(payment.updated_at).toLocaleString()}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ApprovePayment({
  payment,
  onSuccess,
}: {
  payment: PaymentPublic
  onSuccess: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const mutation = useMutation({
    mutationFn: () => PaymentsService.approvePayment({ paymentId: payment.id }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["payments"] })
      const previousData = queryClient.getQueriesData({
        queryKey: ["payments"],
      })
      queryClient.setQueriesData(
        { queryKey: ["payments"] },
        (
          old:
            | {
                results: PaymentPublic[]
                paging: { limit: number; offset: number; total: number }
              }
            | undefined,
        ) => {
          if (!old?.results) return old
          return {
            ...old,
            results: old.results.map((p) =>
              p.id === payment.id ? { ...p, status: "approved" } : p,
            ),
          }
        },
      )
      return { previousData }
    },
    onSuccess: () => {
      showSuccessToast("Payment approved successfully")
      setIsOpen(false)
      onSuccess()
    },
    onError: (err, _, context) => {
      context?.previousData?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data)
      })
      createErrorHandler(showErrorToast)(err as ApiError)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["payments"] }),
  })

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuItem
        onSelect={(e) => e.preventDefault()}
        onClick={() => setIsOpen(true)}
        disabled={payment.status === "approved"}
      >
        <Check className="mr-2 h-4 w-4" />
        Approve Payment
      </DropdownMenuItem>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve Payment</DialogTitle>
          <DialogDescription>
            Are you sure you want to manually approve this payment of $
            {payment.amount} {payment.currency}? This will assign the purchased
            products to the attendees.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <LoadingButton
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Approve
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PaymentActionsMenu({ payment }: { payment: PaymentPublic }) {
  const [open, setOpen] = useState(false)
  const { isAdmin } = useAuth()
  const [, copy] = useCopyToClipboard()
  const { showSuccessToast } = useCustomToast()

  const copyPaymentId = () => {
    copy(payment.id)
    showSuccessToast("Payment ID copied")
    setOpen(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Payment actions">
          <EllipsisVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ViewPayment payment={payment} />
        <DropdownMenuItem onClick={copyPaymentId}>
          <Copy className="mr-2 h-4 w-4" />
          Copy Payment ID
        </DropdownMenuItem>

        {isAdmin && payment.status === "pending" && (
          <>
            <DropdownMenuSeparator />
            <ApprovePayment
              payment={payment}
              onSuccess={() => setOpen(false)}
            />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

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
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <PaymentActionsMenu payment={row.original} />
      </div>
    ),
  },
]

function PaymentsTableContent() {
  const { selectedPopupId } = useWorkspace()
  const { isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const searchParams = Route.useSearch()
  const { search, pagination, setSearch, setPagination } = useTableSearchParams(
    searchParams,
    "/payments",
  )

  const { data: payments } = useSuspenseQuery(
    getPaymentsQueryOptions(
      selectedPopupId,
      pagination.pageIndex,
      pagination.pageSize,
    ),
  )

  const bulkApproveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(
        ids.map((id) => PaymentsService.approvePayment({ paymentId: id })),
      )
    },
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: ["payments"] })
      const previousData = queryClient.getQueriesData({
        queryKey: ["payments"],
      })
      const idSet = new Set(ids)
      queryClient.setQueriesData(
        { queryKey: ["payments"] },
        (
          old:
            | {
                results: PaymentPublic[]
                paging: { limit: number; offset: number; total: number }
              }
            | undefined,
        ) => {
          if (!old?.results) return old
          return {
            ...old,
            results: old.results.map((p) =>
              idSet.has(p.id) ? { ...p, status: "approved" } : p,
            ),
          }
        },
      )
      return { previousData }
    },
    onSuccess: (_, ids) => {
      showSuccessToast(`${ids.length} payment(s) approved`)
    },
    onError: (err, _, context) => {
      context?.previousData?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data)
      })
      createErrorHandler(showErrorToast)(err as ApiError)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["payments"] }),
  })

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
      hiddenOnMobile={["source", "coupon_code", "created_at"]}
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
      selectable={isAdmin}
      bulkActions={
        isAdmin
          ? (selectedRows) => {
              const approvable = (selectedRows as PaymentPublic[]).filter(
                (p) => p.status === "pending",
              )
              return (
                <Button
                  size="sm"
                  disabled={
                    approvable.length === 0 || bulkApproveMutation.isPending
                  }
                  onClick={() =>
                    bulkApproveMutation.mutate(approvable.map((p) => p.id))
                  }
                >
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                  Approve ({approvable.length})
                </Button>
              )
            }
          : undefined
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
      exportToCsv(
        "payments",
        results as unknown as Record<string, unknown>[],
        [
          { key: "amount", label: "Amount" },
          { key: "currency", label: "Currency" },
          { key: "status", label: "Status" },
          { key: "source", label: "Source" },
          { key: "coupon_code", label: "Coupon" },
          { key: "created_at", label: "Date" },
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
