import type {
  PaymentProductResponse,
  PaymentPublic,
  PaymentStatus,
} from "@/client"

interface PaymentsQueryInput {
  popupId: string | null
  page: number
  pageSize: number
  search: string
  statusFilter?: PaymentStatus
  sortBy?: string
  sortOrder?: "asc" | "desc"
}

interface PaymentsPaging {
  total: number
}

interface PaymentsResponse<TPayment> {
  results: TPayment[]
  paging: PaymentsPaging
}

interface PaymentsPagination {
  pageIndex: number
  pageSize: number
}

interface PaymentsTableStateInput<TPayment> {
  payments: PaymentsResponse<TPayment>
  pagination: PaymentsPagination
}

export function buildPaymentsQueryConfig({
  popupId,
  page,
  pageSize,
  search,
  statusFilter,
  sortBy,
  sortOrder,
}: PaymentsQueryInput) {
  const normalizedSearch = search.trim()

  return {
    params: {
      skip: page * pageSize,
      limit: pageSize,
      popupId: popupId || undefined,
      search: normalizedSearch || undefined,
      paymentStatus: statusFilter || undefined,
      sortBy: sortBy || undefined,
      sortOrder: sortBy ? (sortOrder ?? "desc") : undefined,
    },
    queryKey: [
      "payments",
      popupId,
      {
        page,
        pageSize,
        search: normalizedSearch,
        statusFilter,
        sortBy,
        sortOrder,
      },
    ],
  }
}

/**
 * Returns the effective unit price for a payment line item.
 * Patron lines carry a non-null effective_unit_price (the donor-chosen amount).
 * Non-patron lines carry null and fall back to the catalogued product_price.
 * Uses nullish coalescing so that a legitimate 0-value effective_unit_price
 * is honoured rather than falling through to product_price.
 */
export function resolveLineUnitPrice(
  item: Pick<PaymentProductResponse, "effective_unit_price" | "product_price">,
): number {
  return Number(item.effective_unit_price ?? item.product_price)
}

export function buildPaymentsTableState<TPayment>({
  payments,
  pagination,
}: PaymentsTableStateInput<TPayment>) {
  return {
    data: payments.results,
    serverPagination: {
      total: payments.paging.total,
      pagination,
    },
  }
}

// SimpleFi can adjust the final charged total. We can derive the percentage
// from the quoted amount and the charged amount only once the charged amount is
// final; in-flight installment plans expose a running collected total instead.
export function getRailAdjustment(payment: PaymentPublic): {
  pct: string
  isDiscount: boolean
  delta: number
  final: boolean
} | null {
  const amount = Number(payment.amount)
  if (payment.amount_charged == null || amount <= 0) return null
  const total = payment.installments_total
  const isPlan =
    payment.is_installment_plan === true && total != null && total >= 2
  const final = !isPlan || (payment.installments_paid ?? 0) >= (total ?? 0)
  const delta = Number(payment.amount_charged) - amount
  const rawPct = (delta / amount) * 100
  const rounded = Math.round(rawPct)
  // Installment cycles round per charge, so a completed plan lands within a
  // few cents of the exact rail percentage — snap to the integer when close.
  const pct =
    Math.abs(rawPct - rounded) < 0.1
      ? String(Math.abs(rounded))
      : Math.abs(rawPct).toFixed(1)
  return { pct, isDiscount: delta < 0, delta, final }
}
