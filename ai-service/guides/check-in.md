---
name: check-in
description: Enable self-service check-in, share its link or QR, and see who checked in. Explains where ticket scanning happens.
triggers: check in,check-in,checkin,scan,scanner,scan qr,qr code,scan tickets,check in attendee,manual check in,self check-in,self-service check-in,who checked in,check-in history,door,entrance,check in controller,escanear,ingreso,acreditacion
routes: /check-in,/popups/$id/edit
roles: viewer
---
**Where:** Sidebar → "Registrations" → "Check In" ([Check In](/check-in)).

**Requires:** A selected gathering.

**Ticket scanning:**
- Scanning ticket QR codes or manually checking in a ticket: this can't be done from the backoffice.
- Scanning is done outside the backoffice, by users with the "Check In Controller" role in the scanner, or by attendees themselves through self-service check-in.

**Enable self-service check-in:**
1. Open Check In.
2. In the "Self-service check-in" card, click "Enable".
3. Share the URL ("Copy URL") or the QR code with attendees. "Disable" turns it off.

The same setting is the "Enable attendee self check-in" switch in [Gatherings](/popups) → edit → "Features".

**See who checked in:**
1. The table lists every scan: Date, Holder, Product, Sales flow and Source (QR scan / Manual / Self-service).
2. Use "Search by name, email, code or product..." and "Filter" (Source, Date, Product, Product type).
3. Expand a row to see the code and who scanned it.

**Gotchas:**
- The card is hidden when the organization has no portal domain.
- Event attendance (workshops and talks) is separate. It lives on each event's page in the "Attendance" card.
- Check-in history cannot be exported from this page. Ask EdgeOS can prepare a custom export if one is needed.
