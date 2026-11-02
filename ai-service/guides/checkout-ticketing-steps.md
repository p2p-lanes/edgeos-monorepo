---
name: checkout-ticketing-steps
description: Configure the checkout steps of a sales flow, choose which products each step shows, reorder steps and preview the checkout.
triggers: ticketing steps,checkout steps,checkout,configure checkout,product not in checkout,product not showing,doesn't appear in checkout,reorder checkout,add step,checkout step,preview checkout,step template,ticket cards,ticket select,buyer form,review and confirm,allow editing after purchase,edit form after purchase,pay button,insurance card,pasos del checkout
routes: /ticketing-steps
roles: operator
---
**Where:** Sidebar → "Gathering Management" → "Ticketing Steps" ([Ticketing Steps](/ticketing-steps)).

**Requires:** A selected gathering and operator or above. The page says "You need admin permissions…", but operators can use it.

**Steps:**
1. Pick the sales flow in the flow selector at the top. Each flow has its own checkout.
2. Turn a step on or off with its switch. Steps with a "Protected" badge cannot be turned off.
3. Drag steps to reorder them.
4. To add a step, click "+ Add step" and fill in:
   - "Title".
   - "Template", e.g. "Ticket Select", "Ticket Cards", "Merch Cards", "Patron Presets", "Accommodation", "Rich Text / Banner", "FAQs".
   - "Product Category".
5. Click a step to edit it ("General" and "Translations" tabs). The "Product Category" decides which products it shows. Click "Save".
6. Click "Preview checkout" to see it on desktop or mobile, including unsaved changes.

**Variants:**
- "Buyer Form" ("Your information") takes its questions from [Form Builder](/form-builder). It has "Allow editing after purchase" with a deadline.
- "Review & Confirm" has the "Insurance Card" and "Pay Button" labels.
- The "Ticket sales" card ("Sales open" switch) is also on this page.

**Gotchas:**
- A product shows only if it is "Active", in a step's category, inside its sale window and in stock.
- Delete a step with the trash icon ("Step deleted").
