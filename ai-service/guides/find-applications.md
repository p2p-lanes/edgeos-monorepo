---
name: find-applications
description: Find, filter, group, save views of and export applications, and read an application's details.
triggers: applications,application,applicants,find application,where are the applications,list applications,filter applications,search application,export applications,applications csv,scholarship requests,pending applications,in review,accepted applications,rejected applications,application details,saved view,group by,columns,aplicaciones,solicitudes
routes: /applications,/applications/$id
roles: viewer
---
**Where:** Sidebar → "Registrations" → "Applications" ([Applications](/applications)). The badge on the item counts applications waiting for your review.

**Requires:** A selected gathering.

**Find:**
1. Type in "Search by name or email...".
2. Click "Filter" → "Add filter". Useful fields:
   - Status: Draft, Pending Fee, In Review, Accepted, Rejected, Withdrawn.
   - "Scholarship requested" and "Scholarship status".
   - "Reviewed by" and "Reviewed by me".
   - Rating, Submitted, Referral.
   - Any form field.
3. Use "Group by" to split the list, e.g. by Status or a form field.
4. Use "Columns" to show more fields. Every form question is available.
5. "Views" → "Save current view" saves the setup for the whole team. "Clear" resets it.

**Export:** "Export CSV", or "Export filtered CSV" when a filter or search is active. The export includes every custom form field.

**Open one:** Click the row. The detail page shows:
- applicant data, access sources (group, invite, referral) and form answers;
- "Related records" (Human, Payments, Attendees, Previous applications);
- the review sidebar.

**Gotchas:**
- "Pending Fee" only exists when the flow requires an application fee.
- For custom columns across resources, Ask EdgeOS can prepare a custom export.
