---
name: create-and-launch-gathering
description: Create a gathering, configure its tabs, publish it (status Active, show in portal) and delete it.
triggers: create gathering,new gathering,create popup,new popup,create festival,new event edition,launch,go live,publish gathering,activate,status,draft,active,ended,show in portal,not in portal,not showing,dates,currency,simplefi,payment integration,invoice settings,branding,cover image,delete gathering,crear gathering,publicar
routes: /popups,/popups/new,/popups/$id/edit
roles: operator
---
**Where:** Sidebar → "Gathering Management" → "Gatherings" ([Gatherings](/popups)).

**Requires:** Operator or above. Superadmins must select an organization first.

**Create:**
1. Click "Add Gathering".
2. On "General", fill in the name, "Tagline", "Location", "Start Date" and "End Date". The start date must be today or later.
3. On "Commerce", choose the "Main way in":
   - "Gathering / application flow": people apply first.
   - "Festival / direct ticketing": people buy directly.
   This creates the first sales flow. Then pick "Currency".
4. Click "Create Event". The button says "Create Event" even though the page creates a gathering.

**Edit:** Click the gathering in the list. The tabs are:
- "General": status, dates, "Application Review", "Reviewers".
- "Commerce": currency, "Payment Pricing" adjustments, the SimpleFi API key, "Invoice Settings".
- "Features": portal visibility, self check-in, directory, badges, events module, pass editing.
- "Branding": images and links.
- "Portal sidebar": admin only.
- "Home page": custom portal home, third-party apps.
- "Languages".

Save with "Save Changes".

**Go live:**
1. Set the status badge on "General" to "Active".
2. On "Features", turn on "Show in portal" so the gathering appears in the portal.
3. Make sure a SimpleFi API key is set, either on "Commerce" or on the sales flow. Otherwise saving shows "Saved, but not ready to launch".
4. Check that the sales flows say "Ready to sell" ([Sales Flows](/sales-flows)).

**Open the portal:** In the list, open the row's ⋮ menu → "Open Portal" or "Open checkout". This needs a portal domain on the organization.

**Delete:** "General" → "Danger Zone" → "Delete Event". This permanently removes products, groups, coupons and attendee data.

**Gotchas:**
- "Show in portal" and the status are independent.
- "Main way in" only exists on create. Later, how people get in is decided per sales flow.
- Fees, installments, coupons, scholarships and reminders are configured on each sales flow, not on the gathering.
