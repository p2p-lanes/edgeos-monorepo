import type { HumanActivityItem, HumanActivityProduct } from "@/client"

/** Render a `[{product_name, quantity}]` list as "2x General, 1x VIP". */
function formatProductList(products: HumanActivityProduct[]): string {
  return products
    .map((p) => `${p.quantity ?? 1}x ${p.product_name ?? "ticket"}`)
    .join(", ")
}

/** Human-readable label (with emoji) for a HumanRating value. */
const RATING_LABELS: Record<string, string> = {
  sin_calificar: "No rating",
  red_flag: "🔴 Red Flag",
  orange_flag: "🟠 Orange Flag",
  green_flag: "🟢 Green Flag",
  star: "⭐ Star",
}

export function ratingLabel(rating: string | null | undefined): string {
  if (!rating) return "No rating"
  return RATING_LABELS[rating] ?? rating
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
          ? ` - ${item.amount}${item.currency ? ` ${item.currency}` : ""}`
          : ""
      return `Purchased ${names}${amount}`
    }
    case "ticket.added":
      return withPopup("Ticket added", item)
    case "note.added":
      return item.note ?? "Note added"
    case "rating.changed":
      return `Changed rating to ${ratingLabel(item.rating)}`
    case "comment.added":
      return item.note ?? "Commented"
    case "credit.granted": {
      const amt = item.amount != null ? ` +${item.amount}` : ""
      return withPopup(`Credit granted${amt}`, item)
    }
    case "credit.applied": {
      const amt = item.amount != null ? ` ${item.amount}` : ""
      return withPopup(`Credit applied${amt}`, item)
    }
    case "credit.restored": {
      const amt = item.amount != null ? ` +${item.amount}` : ""
      return withPopup(`Credit restored${amt}`, item)
    }
    case "passes.edited":
      return withPopup("Passes edited", item)
    default:
      return item.kind
  }
}
