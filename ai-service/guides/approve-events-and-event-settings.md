---
name: approve-events-and-event-settings
description: Approve or reject events submitted by attendees and configure who can create events, approval, timezone, types and tags.
triggers: approve event,reject event,pending approval,event approval,events submitted,attendee events,who can create events,stop event creation,disable event creation,event settings,timezone,event types,event tags,require approval,approval email,hide events,aprobar evento,configuracion de eventos
routes: /events,/events/settings
roles: operator
---
**Where:** Approvals in [Events](/events) (Table view); settings in Sidebar → "Events" → "Event Settings".

**Approve or reject events:**
1. Go to [Events](/events).
2. Switch to the **"Table"** view with the view switcher. Approve and Reject only exist in this view.
3. Set the status filter to "Pending approval".
4. On the row, click "Approve" or "Reject", optionally add a note, and confirm. The creator is notified, and approved events become public.

Requires operator or above.

**Event settings:** Sidebar → "Events" → "Event Settings" ([Event Settings](/events/settings)). Only admins can change them.
- "Allow new event creation": when off, the portal "Create Event" button is hidden.
- "Who Can Create Events": "Everyone" or "Admins Only".
- "Human-created events require approval": sends portal events to "Pending approval". Only shown with "Everyone".
- "Default Timezone", "Allowed event types", "Allowed event tags", "Approval notification emails".
- "Venue permissions": whether humans can create venues, and whether those venues need approval.

**Gotchas:**
- Every setting saves immediately ("Event settings saved"). There is no Save button.
- To hide events from the portal entirely, turn off "Enable events module" in [Gatherings](/popups) → edit → "Features".
- Empty "Allowed event types" disables the Type field. Empty "Allowed event tags" disables tagging.
