import type { PersonalTicketsPublic } from "@/client"

/** Personal ticket reads are display-only; never turn them into checkout recipients. */
export function projectPersonalTickets(
  rows: PersonalTicketsPublic[],
  popupId: string,
  representedAttendeeIds: Set<string> = new Set(),
): PersonalTicketsPublic[] {
  return rows.flatMap((row) => {
    if (row.popup_id !== popupId || representedAttendeeIds.has(row.id)) {
      return []
    }
    const tickets = (row.tickets ?? []).filter(
      (ticket) =>
        ticket.attendee_id === row.id &&
        ticket.revoked_at == null &&
        ticket.product_category_snapshot === "ticket",
    )
    const products = row.products.filter(
      (product) => product.category === "ticket" && (product.quantity ?? 0) > 0,
    )
    // Keep summary-only responses readable during a backend-first rollout.
    if (tickets.length === 0 && (row.tickets != null || products.length === 0))
      return []
    return [{ ...row, tickets, products }]
  })
}
