interface PaymentsQueryInput {
  popupId: string | null
  page: number
  pageSize: number
  search: string
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
}: PaymentsQueryInput) {
  const normalizedSearch = search.trim()

  return {
    params: {
      skip: page * pageSize,
      limit: pageSize,
      popupId: popupId || undefined,
      search: normalizedSearch || undefined,
    },
    queryKey: [
      "payments",
      popupId,
      { page, pageSize, search: normalizedSearch },
    ],
  }
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
