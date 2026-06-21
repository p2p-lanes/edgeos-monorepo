import type { HumanActivityItem, HumanActivityProduct } from "@/client"

/** Render a `[{product_name, quantity}]` list as "2x General, 1x VIP". */
function formatProductList(products: HumanActivityProduct[]): string {
  return products
    .map((p) => `${p.quantity ?? 1}x ${p.product_name ?? "ticket"}`)
    .join(", ")
}

function withPopup(text: string, item: HumanActivityItem): string {
  return item.popup_label ? `${text} — ${item.popup_label}` : text
}

/**
 * Render a readable sentence for a human activity timeline item from its kind +
 * payload. Items are the typed `HumanActivityItem` (not `AuditLogPublic`), so
 * this is a separate helper from `auditMessage.ts`.
 */
export function describeHumanActivity(item: HumanActivityItem): string {
  switch (item.kind) {
    case "application.submitted":
      return withPopup("Submitted an application", item)
    case "application.accepted":
      return withPopup("Application accepted", item)
    case "payment.completed": {
      const products = item.products ?? []
      const names = products.length ? formatProductList(products) : "products"
      const amount =
        item.amount != null
          ? ` — ${item.amount}${item.currency ? ` ${item.currency}` : ""}`
          : ""
      return `Purchased ${names}${amount}`
    }
    case "ticket.added":
      return withPopup("Ticket added", item)
    case "note.added":
      return item.note ?? "Note added"
    default:
      return item.kind
  }
}
