import type { PaymentPublic } from "@/client"

export type OrderStatus =
  | "approved"
  | "pending"
  | "rejected"
  | "expired"
  | "cancelled"
  | "unknown"

export interface OrderProjection {
  id: string
  status: OrderStatus
  provenance: "known" | "legacy"
  total: string
  currency: string
  createdAt: string | null
  invoiceAvailable: boolean
  lines: Array<{
    id: string
    name: string
    category: string
    quantity: number
    unitPrice: string
    currency: string
  }>
}

const knownStatuses = new Set<OrderStatus>([
  "approved",
  "pending",
  "rejected",
  "expired",
  "cancelled",
])

function projectStatus(status: string | undefined): OrderStatus {
  return status && knownStatuses.has(status as OrderStatus)
    ? (status as OrderStatus)
    : "unknown"
}

export function projectOrders(
  payments: PaymentPublic[],
  invoiceAvailable: boolean,
): OrderProjection[] {
  return payments
    .map((payment, index): { index: number; order: OrderProjection } => ({
      index,
      order: {
        id: payment.id,
        status: projectStatus(payment.status),
        provenance: payment.sales_flow_id ? "known" : "legacy",
        total: payment.amount ?? "0",
        currency: payment.currency ?? "USD",
        createdAt: payment.created_at ?? null,
        invoiceAvailable,
        lines: (payment.products_snapshot ?? []).map((line, lineIndex) => ({
          id: `${line.product_id}-${line.attendee_id}-${lineIndex}`,
          name: line.product_name,
          category: line.product_category,
          quantity: line.quantity,
          unitPrice: line.effective_unit_price ?? line.product_price,
          currency: line.product_currency,
        })),
      },
    }))
    .sort((left, right) => {
      const leftTime = left.order.createdAt
        ? Date.parse(left.order.createdAt)
        : Number.NaN
      const rightTime = right.order.createdAt
        ? Date.parse(right.order.createdAt)
        : Number.NaN
      const leftIsValid = Number.isFinite(leftTime)
      const rightIsValid = Number.isFinite(rightTime)

      if (leftIsValid && rightIsValid) {
        return rightTime - leftTime || left.index - right.index
      }

      if (leftIsValid) return -1
      if (rightIsValid) return 1

      return left.index - right.index
    })
    .map(({ order }) => order)
}
