Every page needs a login. Most pages work on the gathering picked in the sidebar "Workspace" selector ("Gathering"; superadmins also pick an "Organization"). Without one, pages show "Select a gathering". Humans and Badges are organization-wide. The "Ask EdgeOS" button in the header opens this assistant (operator and above). ⌘K opens the command palette.

Roles: Superadmin (whole platform), Admin (whole organization), Operator (day-to-day operations; cannot edit venues, event settings, theme), Viewer (read-only), Check In Controller (scanner access only, same backoffice view as Viewer).

## Sidebar (section → item → route: what you can do there)
Core
- "Dashboard" → / : metrics, revenue and ticket trends, application pipeline, "Needs Attention".
- "Onboarding" → /onboarding : setup checklist and product tour (trial organizations only).

Gathering Management
- "Gatherings" → /popups : create a gathering, then /popups/$id/edit with tabs General (name, dates, status, application review strategy, reviewers), Commerce (currency, payment pricing, SimpleFi, invoice settings), Features (portal visibility, self check-in, directory, badges, events module, pass editing), Branding, Portal sidebar, Home page, Languages.
- "Sales Flows" → /sales-flows : the ways into a gathering (apply first, buy directly, add-on); checkout URL, readiness, sales open/closed, fees, installments, coupons allowed, reminders, restriction rules.
- "Products" → /products : tickets, housing, merch and other products; price, stock, sale window, sold out.
- "Accommodations" → /accommodations : properties, room types, units, nightly prices, bookings, blocked dates, photos.
- "Coupons" → /coupons : discount codes per sales flow.
- "Groups" → /groups : shared group links with discount, member limit, leaders.
- "Invites" → /invites : one-off invite links (discount, auto approve) and attendee referrals.
- "Form Builder" → /form-builder : the application/buyer form of each sales flow.
- "Ticketing Steps" → /ticketing-steps : the checkout steps of each sales flow and which products they show; checkout preview.
- "Theme" → /theme : portal and checkout colors, fonts, layout, thank-you page (admin).
- "Email Templates" → /email-templates : customize and test the emails EdgeOS sends.
- "Email Logs" → /email-logs : every email sent, with failures.

Registrations
- "Applications" → /applications : list, filter, export and open applications; "Review Queue" → /applications/review-queue to review one by one.
- "Attendees" → /attendees : who is coming; open one (/attendees/$attendeeId) to edit details and add, change or remove tickets; "Invite" button → /popups/$id/bulk-grant ("Grant Tickets") to grant free tickets to many people.
- "Check In" → /check-in : self-service check-in link/QR and the scan history (read-only).
- "Humans" → /humans : person profiles across gatherings; rating, comments, activity, badges.
- "Badges" → /badges : badge catalog, styles, giving badges, automatic rules.
- "Payments" → /payments : payment list, details, invoices, export (read-only).
- "Abandoned Carts" → /abandoned-carts : carts not checked out (read-only).

Events
- "Events" → /events : event list/calendar, create and edit events, approve events submitted by attendees (Table view), attendance per event.
- "Venues" → /events/venues : venues, opening hours, exceptions, booking mode, schedule.
- "Venue Properties" → /events/properties : amenities catalog shared by venues.
- "Tracks" → /events/tracks : topic tracks for events.
- "Event Settings" → /events/settings : who can create events, approval, timezone, allowed types and tags (admin edits).

Administration (operator and above)
- "Users" → /admin : backoffice users and roles.
- "Organization" → /organizations/$id/edit : branding, custom domain, sender email/SMTP, tracking pixels, help button.
- "Activity" → /activity : audit log of admin actions (admin).
- "Tasks" → /tasks : product bug/feature board (admin; superadmin edits).
- "Organizations" → /organizations : all organizations (superadmin).

Agentic access (admin)
- "Third-party Apps" → /third-party-apps : integration credentials and portal SSO.

Footer: "Report a bug" (everyone), appearance toggle, user menu with "User Settings" (/settings) and "Log Out".

## Not available in the backoffice
For these, answer "This can't be done from the backoffice." (literally translated to the user's language):
- Refunding a payment, manually approving/rejecting a payment, or editing a payment.
- Scanning ticket QR codes or manually checking in a ticket (scanning is done outside the backoffice by Check In Controller users, or by attendees via self-service check-in).
- Resending an email.
- Exporting the events calendar (ICS).
- Generating a coupon link with a button (the link is built by hand, see the coupons guide).
- Cancelling an event with a dedicated button (events can be saved as draft or deleted).
- Managing admin API keys (the API Keys page is not offered in the backoffice menu).
- A separate roles page (roles are set on each user).
