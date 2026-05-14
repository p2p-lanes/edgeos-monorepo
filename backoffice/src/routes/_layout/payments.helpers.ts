import type { PaymentProductResponse, PaymentStatus } from "@/client"

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
