import type { AuditLogPublic } from "@/client"

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

/** Render a `[{product_name, quantity}]` details list as "2x A, 1x B". */
function formatProductList(value: unknown): string {
  const products = Array.isArray(value) ? value : []
  return products
    .map((p) => {
      const item = p as Record<string, unknown>
      const qty = typeof item.quantity === "number" ? item.quantity : 1
      return `${qty}x ${asString(item.product_name) ?? "ticket"}`
    })
    .join(", ")
}

/** Display name for whoever performed the action. */
export function actorLabel(log: AuditLogPublic): string {
  return log.actor_name ?? log.actor_email ?? "Unknown"
}

const EVENT_ACTION_VERBS: Record<string, string> = {
  "event.created": "Created event",
  "event.updated": "Updated event",
  "event.deleted": "Deleted event",
  "event.cancelled": "Cancelled event",
  "event.approved": "Approved event",
  "event.rejected": "Rejected event",
  "event.recurrence_set": "Set recurrence",
  "event.occurrence_detached": "Detached occurrence",
  "event.occurrence_skipped": "Skipped occurrence",
  "event.invitation_added": "Added invitation",
  "event.invitation_removed": "Removed invitation",
  "event.hidden": "Hid event",
  "event.unhidden": "Unhid event",
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
    case "ticket.add": {
      const names = formatProductList(d.products)
      return names ? `Added ${names}` : "Added tickets"
    }
    case "ticket.remove":
      return `Removed ticket "${asString(d.product_name) ?? "unknown"}"`
    case "ticket.grant": {
      const names = formatProductList(d.products)
      return names ? `Granted ${names}` : "Granted tickets"
    }
    default: {
      const eventVerb = EVENT_ACTION_VERBS[log.action]
      if (eventVerb) {
        const title = log.entity_label ? ` "${log.entity_label}"` : ""
        // For updates, append the changed field names when available.
        if (log.action === "event.updated") {
          const changes = (d.changes ?? {}) as Record<string, unknown>
          const fields = Object.keys(changes)
          if (fields.length > 0) {
            return `${eventVerb}${title} (${fields.join(", ")})`
          }
        }
        return `${eventVerb}${title}`
      }
      return log.action
    }
  }
}

/** Known action values for the global feed filter dropdown. */
export const AUDIT_ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: "ticket.swap", label: "Ticket changed" },
  { value: "ticket.add", label: "Ticket added" },
  { value: "ticket.remove", label: "Ticket removed" },
  { value: "ticket.grant", label: "Ticket granted" },
  { value: "event.created", label: "Event created" },
  { value: "event.updated", label: "Event updated" },
  { value: "event.deleted", label: "Event deleted" },
  { value: "event.cancelled", label: "Event cancelled" },
  { value: "event.approved", label: "Event approved" },
  { value: "event.rejected", label: "Event rejected" },
]
