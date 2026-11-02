---
name: bulk-grant-tickets
description: Grant free tickets to many people at once by email or CSV upload (Grant Tickets page, opened with the Invite button on Attendees).
triggers: bulk grant,grant tickets,grant many,mass grant,free tickets to many,give tickets to a list,upload csv,import csv,csv of emails,guest list upload,comp tickets,speakers tickets,volunteer tickets,staff tickets,invite people,grant to email,person not attendee,regalar entradas,subir csv,muchas personas
routes: /attendees,/popups/$id/bulk-grant
roles: operator
---
**Where:** Sidebar → "Registrations" → "Attendees" ([Attendees](/attendees)) → the **"Invite"** button in the header. It opens the "Grant Tickets" page. This is the only way to reach it.

**Requires:** A selected gathering and operator or above.

**Steps:**
1. In panel "1. People", add people. Either:
   - click "Add person" and enter an email, or
   - click "Import CSV" with a single `email` column. "Template" downloads an example.
2. In panel "2. Default tickets per person", check the products and set "Qty / person".
3. Optional: click a person's ticket strip to give them different tickets ("Tickets for <email>" → "Save"). "Reset to default" undoes it.
4. Check the summary ("Granting N tickets to M persons") and click "Grant tickets".

**Gotchas:**
- "Import CSV" replaces the current list. Duplicates and blank rows are skipped, and emails are lowercased.
- "Grant tickets" stays disabled while any email is invalid, someone has no tickets, or a product is short on stock or above "max per order".
- Only active products can be granted.
- The grant is all or nothing. Tickets are free (no payment) and decrement stock.
- People without an account get a Human and an Attendee created automatically.
- No email is sent to the recipients.
- The button says "Invite" but it grants tickets. It is unrelated to [Invites](/invites) links.
