---
name: create-events
description: Create, edit, publish and delete events (talks, workshops) in a gathering, including recurring and private events and invitations.
triggers: create event,new event,add event,schedule event,talk,workshop,session,activity,recurring event,repeat event,weekly event,private event,unlisted event,invite to event,event invitation,edit event,publish event,draft event,delete event,cancel event,event calendar,venue booking,co-organizer,collaborator,crear evento,charla,taller
routes: /events,/events/new,/events/$eventId,/events/$eventId/edit
roles: operator
---
**Where:** Sidebar → "Events" → "Events" ([Events](/events)).

**Requires:** A selected gathering and operator or above to create or edit.

**Create:**
1. Click "+ Create Event".
2. Fill in the "Title".
3. Pick a venue, or "Custom location" ("Place name" + "Google Maps link"). "View venue schedule" shows free slots.
4. Set "Date", "Start time" and "Duration". The availability line must say "Slot available".
5. Optionally:
   - "Repeats" (Daily, Weekly, Monthly) with an end rule.
   - "Visibility": Public, Private or Unlisted.
   - "Type", "Track", "Description", "Collaborators", cover image, "Max participants".
6. Click "Publish Event", or "Save as Draft".

Clicking a free slot on a venue schedule also starts a new event ("Create event?" → "Create").

**Edit:**
1. Click the event, then "Edit".
2. For a recurring event, choose "Edit series" or "Edit only this event".
3. Save.

**Invite people (Private/Unlisted only):**
1. Create the event first.
2. On its edit page, use "Invitations": paste emails (one per line) and click "Invite".

**Delete:** Edit page → "Delete Event". It removes RSVPs and invitations.

**Gotchas:**
- Events cannot start in the past.
- "Publish Event" is disabled while the slot conflicts or the venue is closed.
- Times use the timezone in [Event Settings](/events/settings).
- Cancelling an event with a dedicated button: this can't be done from the backoffice. Save it as draft or delete it instead.
- Exporting the calendar (ICS): this can't be done from the backoffice.
- "Share" on the event page copies its portal link.

**The assistant can do it:** Ask EdgeOS can create and configure events for you after you approve.
