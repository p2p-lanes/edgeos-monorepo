---
name: attendee-ticket-operations
description: Assign, swap, inspect, or remove products and tickets for an attendee.
triggers: attendee,attendees,participant,ticket,tickets,pass,product,assign,grant,swap,remove,asignar,entrada,producto
operations: attendees-list_attendees,attendees-get_attendee,products-list_products,products-get_product,attendees-add_attendee_ticket,attendees-swap_attendee_ticket_product,attendees-remove_attendee_ticket
---
Treat every `attendee_products` row as one first-class ticket. A manual product assignment creates a ticket with its own check-in code and no payment; it does not rewrite the historical payment snapshot.

1. Require a selected gathering and resolve the attendee from live data. If multiple people match, ask the user to disambiguate.
2. Resolve the product from the same gathering. For a new grant, prefer active products and inspect remaining stock.
3. Read the attendee before writing. Do not assume that similarly named products or existing tickets are equivalent.
4. Use the ticket-add operation for a new assignment, with one item per product and an explicit quantity. Explain that this is a manual grant and affects stock.
5. To change an existing ticket, identify the exact ticket row and use the swap operation so its check-in identity is preserved.
6. Removing a ticket is destructive and restores stock. Never remove a paid ticket merely because the user asked to remove a product without clarifying the intended ticket.
7. After execution, read the attendee again and verify the resulting tickets. Report partial failures exactly; never retry an ambiguous write.
