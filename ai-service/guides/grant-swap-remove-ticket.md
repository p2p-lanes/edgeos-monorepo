---
name: grant-swap-remove-ticket
description: Give one attendee a free ticket, change (swap) an attendee's ticket to another product, or remove a ticket.
triggers: grant ticket,give ticket,free ticket,comp ticket,complimentary,assign ticket,assign product,add ticket,change ticket,swap ticket,upgrade ticket,change pass,switch product,remove ticket,delete ticket,take away ticket,cancel ticket,regalar entrada,dar ticket,cambiar ticket,quitar ticket
routes: /attendees,/attendees/$attendeeId
roles: operator
---
**Where:** Sidebar → "Registrations" → "Attendees" ([Attendees](/attendees)) → click the person → "Tickets" section.

**Requires:** A selected gathering and operator or above. The person must already be an attendee. If they are not, use bulk grant (bulk-grant-tickets guide), which also works for one email.

**Grant a free ticket:**
1. Open the attendee.
2. In "Add tickets", check the product and set "Qty". Only active products are listed, and the stock column shows availability.
3. Click "Add N ticket(s)". The toast says "Tickets added".

**Swap (change) a ticket:**
1. Under "Current tickets", click the product name on the ticket card ("tap the name to change").
2. Pick the new product. It changes immediately, with no confirmation ("Ticket product updated").

**Remove a ticket:** Click the trash icon ("Remove ticket"), then "Remove".

**Gotchas:**
- A grant creates no payment. The ticket shows "Granted" instead of "Paid".
- Grants decrement stock and are blocked when stock is short ("Only N in stock.").
- Removing a ticket frees its stock.
- A swap keeps the ticket's check-in code.
- Admins can assign any active product here, ignoring portal ticketing restrictions.
- Every change appears in the attendee's "Activity" and in [Activity](/activity).
- Refunding the payment of a removed ticket: this can't be done from the backoffice.

**The assistant can do it:** Ask EdgeOS can add, swap or remove the ticket for you after you approve the change.
