---
name: sales-flows
description: Create and manage sales flows (ways into a gathering), get the checkout or application link, fix why people can't buy, open or close sales.
triggers: sales flow,sales flows,way in,ways in,checkout link,purchase link,buy link,application link,ticket link,share link,direct sale,sell without application,no application,add-on,upsale,upsell,can't buy,cannot buy,cant buy,why can't people buy,not ready to sell,ready to sell,coming soon,open sales,close sales,sales open,installments,insurance,contribution,application fee,card surcharge,allows coupons,scholarship setting,reminder,abandoned cart email,restriction,flujo de venta,link de compra
routes: /sales-flows,/sales-flows/new,/sales-flows/$id/edit
roles: operator
---
**Where:** Sidebar → "Gathering Management" → "Sales Flows" ([Sales Flows](/sales-flows)).

**Requires:** A selected gathering and operator or above.

**Concept:** Each sales flow is one door into the gathering. It decides:
- whether people apply first or buy directly;
- its checkout steps and form;
- its fees and emails;
- its URL.

The list groups flows as "A stranger finds these" (listed in the portal), "Only if you send the link", and "Only after they are in" (add-ons).

**Create:**
1. Click "Add Sales Flow".
2. Choose what it does: "People apply first", "People buy directly" or "An add-on".
3. Choose where it starts: "Start from scratch", or copy an existing flow.
4. Name it, then click "Create the flow".

**Get the link:**
1. Open the flow.
2. The URL card shows "Flow URL" (direct) or "Application entry URL" (application flows).
3. Use the copy button or "Open link". Add-ons have no standalone URL; they are listed in the portal shop.

**Why people can't buy:** The flow's status card and list badges name the blocker:
- "The checkout has no steps…": add steps in [Ticketing Steps](/ticketing-steps).
- "The steps offer no product that is on sale…": activate products or link a category in Ticketing Steps.
- "The application form has no questions": use [Form Builder](/form-builder).
- Sales closed: turn on the "Sales open" switch in the "Ticket sales" card and click "Save ticket sales".
- Also check the gathering status is "Active" and the flow is not closed.

**Configure (edit page sections):**
- "Payment Pricing": card, crypto and installment adjustments; "Inherited" or "Overridden".
- "Application Settings": "Requires Application Fee", "Allows Scholarship", "Allows Incentive".
- "Discounts": "Allows Coupons".
- "Checkout Fees": "Offer Insurance", "Add Contribution".
- "Installment Plans": "Offer Installments", "Max Installments".
- "Ways In": "Accept Invites", "Let Attendees Share".
- "Restriction Rule".
- Reminders: "Abandoned Cart", "Purchase Reminder", "Abandoned Application". An empty delay means nothing is sent.
- "Check-in Pass".

Click "Save Changes".

**Close or delete:**
- "Close" stops new purchases and keeps existing data. It can be reopened.
- "Delete Sales Flow" only works for unused flows.

**Gotchas:**
- Changes apply only to that flow.
- Without a portal domain on the organization there is no link ("Set a portal domain…").
