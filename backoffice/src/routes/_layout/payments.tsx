import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { Check, Copy, EllipsisVertical, ExternalLink, Eye } from "lucide-react"
import { Suspense, useState } from "react"

import { type PaymentPublic, PaymentsService } from "@/client"
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

function getPaymentsQueryOptions(popupId: string | null) {
  return {
    queryFn: () =>
      PaymentsService.listPayments({
        skip: 0,
        limit: 100,
        popupId: popupId || undefined,
      }),
    queryKey: ["payments", popupId],
  }
}

export const Route = createFileRoute("/_layout/payments")({
  component: Payments,
  head: () => ({
    meta: [{ title: "Payments - EdgeOS" }],
  }),
})

const getStatusBadgeVariant = (
  status: string | undefined,
): "default" | "secondary" | "destructive" | "outline" => {
  switch (status) {
    case "approved":
      return "default"
    case "pending":
      return "secondary"
    case "rejected":
    case "expired":
    case "cancelled":
      return "destructive"
    default:
      return "outline"
  }
}

// View Payment Dialog
function ViewPayment({ payment }: { payment: PaymentPublic }) {
  const [isOpen, setIsOpen] = useState(false)
  const { showSuccessToast } = useCustomToast()

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
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
              <Badge variant={getStatusBadgeVariant(payment.status)}>
                {payment.status}
              </Badge>
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
                  {payment.products_snapshot.map((product, idx) => (
                    <div
                      key={idx}
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

// Approve Payment Dialog
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
    onSuccess: () => {
      showSuccessToast("Payment approved successfully")
      setIsOpen(false)
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
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

// Actions Menu
function PaymentActionsMenu({ payment }: { payment: PaymentPublic }) {
  const [open, setOpen] = useState(false)
  const { isAdmin } = useAuth()
  const { showSuccessToast } = useCustomToast()

  const copyPaymentId = () => {
    navigator.clipboard.writeText(payment.id)
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
  // {
  //   accessorKey: "id",
  //   header: "ID",
  //   cell: ({ row }) => (
  //     <span className="font-mono text-sm text-muted-foreground">
  //       {row.original.id.slice(0, 8)}...
  //     </span>
  //   ),
  // },
  {
    accessorKey: "amount",
    header: "Amount",
    cell: ({ row }) => (
      <span className="font-mono">
        ${row.original.amount} {row.original.currency}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={getStatusBadgeVariant(row.original.status)}>
        {row.original.status}
      </Badge>
    ),
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
    header: "Date",
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
  const { data: payments } = useSuspenseQuery(
    getPaymentsQueryOptions(selectedPopupId),
  )
  return <DataTable columns={columns} data={payments.results} />
}

function Payments() {
  const { isContextReady } = useWorkspace()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
          <p className="text-muted-foreground">
            Track and manage payment transactions
          </p>
        </div>
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
