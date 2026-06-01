import type { AuditLogPublic } from "@/client"

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

/**
 * Render a readable English sentence for an audit entry from its action +
 * structured details. Falls back to the raw action for unknown event types so
 * new backend events still show something before the frontend is updated.
 */
export function describeAuditAction(log: AuditLogPublic): string {
  const d = (log.details ?? {}) as Record<string, unknown>

  switch (log.action) {
    case "ticket.swap":
      return `Changed ticket from "${asString(d.old_product_name) ?? "unknown"}" to "${asString(d.new_product_name) ?? "unknown"}"`
    case "ticket.add":
      return `Added ticket "${asString(d.product_name) ?? "unknown"}"`
    case "ticket.remove":
      return `Removed ticket "${asString(d.product_name) ?? "unknown"}"`
    case "ticket.grant": {
      const products = Array.isArray(d.products) ? d.products : []
      const names = products
        .map((p) => {
          const item = p as Record<string, unknown>
          const qty = typeof item.quantity === "number" ? item.quantity : 1
          return `${qty}x ${asString(item.product_name) ?? "ticket"}`
        })
        .join(", ")
      return names ? `Granted ${names}` : "Granted tickets"
    }
    default:
      return log.action
  }
}

/** Known action values for the global feed filter dropdown. */
export const AUDIT_ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: "ticket.swap", label: "Ticket changed" },
  { value: "ticket.add", label: "Ticket added" },
  { value: "ticket.remove", label: "Ticket removed" },
  { value: "ticket.grant", label: "Ticket granted" },
]
