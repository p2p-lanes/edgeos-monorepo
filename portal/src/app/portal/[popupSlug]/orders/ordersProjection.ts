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
  return payments.map((payment) => ({
    id: payment.id,
    status: projectStatus(payment.status),
    provenance: payment.sales_flow_id ? "known" : "legacy",
    total: payment.amount ?? "0",
    currency: payment.currency ?? "USD",
    createdAt: payment.created_at ?? null,
    invoiceAvailable,
    lines: (payment.products_snapshot ?? []).map((line, index) => ({
      id: `${line.product_id}-${line.attendee_id}-${index}`,
      name: line.product_name,
      category: line.product_category,
      quantity: line.quantity,
      unitPrice: line.effective_unit_price ?? line.product_price,
      currency: line.product_currency,
    })),
  }))
}
