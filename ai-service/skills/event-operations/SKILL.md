---
name: event-operations
description: Search, create, schedule, publish, update, or cancel gathering events.
triggers: event,events,schedule,venue,track,host,publish,cancel,evento,eventos,horario,lugar,publicar,cancelar
operations: events-list_events,events-get_event,events-create_event,events-update_event,event-venues-list_venues,tracks-list_tracks
---
Events are gathering-scoped and times carry an explicit timezone.

1. Resolve venue, track, host, collaborators, and related records instead of guessing identifiers.
2. Preserve the user's calendar date, local time, and timezone exactly. Ask when timezone or duration is genuinely missing.
3. Use dedicated publish, cancel, participant, or invitation operations when available rather than simulating them through unrelated field updates.
4. Before changing a scheduled event, inspect current participants and visibility when they affect impact.
5. After execution, read the event and verify title, start/end, timezone, status, visibility, and venue.
