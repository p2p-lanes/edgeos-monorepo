# Events testing plan

Strategy and progress tracker for testing the events section (events, participants, venues, iTIP emails, approval flow).

## Strategy

Test pyramid, tuned for the fact that most events logic is stateful domain code with date/TZ rules:

| Layer         | Share | Tooling                              | Where the value is                                 |
| ------------- | ----- | ------------------------------------ | -------------------------------------------------- |
| Integration   | ~70%  | `pytest` + `testcontainers` Postgres | Recurrence, availability, state machines, iTIP    |
| E2E           | ~20%  | Playwright (backoffice + portal)     | Wiring between front/back on critical flows        |
| Unit          | ~10%  | `pytest` (pure functions)            | RRULE parsing, summarizeRrule, any pure helpers    |
| DB invariants | —     | Raw SQL in CI post-migration         | Shape of persisted data (cheap, catches bugs tests miss) |

Browser-use is deliberately out of scope: these flows are deterministic and form-heavy, so an exploratory agent adds little over Playwright at higher cost/flakiness.

## Coverage status

### Integration (backend)

| Domain                         | File                                     | Status |
| ------------------------------ | ---------------------------------------- | ------ |
| Recurrence (pure RRULE logic)  | `backend/tests/test_recurrence.py`       | done (pre-existing) |
| Venue availability             | `backend/tests/test_venue_availability.py` | done (8 cases) |
| Event CRUD + SEQUENCE bumping  | —                                        | pending |
| Participant state machine      | —                                        | pending |
| iTIP dispatch (REQUEST/UPDATE/CANCEL) | —                                | pending |
| Approval flow (venues/events)  | —                                        | pending |
| Event invitations + dedup      | —                                        | pending |

### E2E (not started)

| Flow                                                              | Target   | Status |
| ----------------------------------------------------------------- | -------- | ------ |
| Admin creates recurring event → edits one occurrence → cancels series | backoffice | pending |
| Human RSVPs → cancels RSVP (email mocked)                         | portal   | pending |
| Admin creates venue with weekly hours + exception → schedules event that collides | backoffice | pending |

### DB invariants (not started)

See "Invariants" section below for the SQL checks to run post-migration in CI.

## Integration test cases (pending — planned)

### Event CRUD + SEQUENCE

- PATCH of calendar fields (title / start / end / venue) increments `sequence` by 1.
- PATCH of non-calendar fields (description, visibility) does NOT change `sequence`.
- POST + publish emits one iTIP REQUEST per recipient.
- DELETE emits one iTIP CANCEL per recipient and sets `status = cancelled`.
- POST `/events/{id}/occurrences` creates an override with `recurrence_master_id` set and `rrule = NULL`.
- Override is returned in lists instead of the generated pseudo-occurrence.
- `exdates` on a master suppress that occurrence without breaking the series.

### Participants

- `registered → checked_in` sets `check_time`.
- `registered → cancelled` preserves `registered_at`.
- Reverse transitions (`cancelled → registered`, `checked_in → registered`) rejected.
- Registration on `cancelled` / `draft` event rejected with 400/409.
- `max_participant` enforced on concurrent registration (race condition — use two clients).
- Portal registration sends iTIP REQUEST to the registering human only.
- Portal cancellation sends iTIP CANCEL to the registering human only.

### Venue availability (done ✓)

All 8 cases live in `test_venue_availability.py`:

- Basic open range in UTC.
- Popup timezone shifts window (America/Argentina/Buenos_Aires).
- Overnight hours (close <= open) span day boundary.
- Closed exception surfaces as busy slot.
- Open exception adds range on day without weekly_hours.
- Event busy slot extends by setup/teardown buffers.
- Cancelled events excluded from busy.
- `end <= start` rejected with 400.

### iTIP dispatch

Mock SMTP (or snapshot the rendered ICS payload) and assert:

- REQUEST on first publish.
- UPDATE with `SEQUENCE+1` on calendar-field PATCH.
- CANCEL with `SEQUENCE+1` on delete.
- `gather_event_recipients` dedupes between `EventInvitations` and active `EventParticipants`.
- ICS content respects popup timezone.

### Approval flow

- `humans_can_create_venues=true` + `venues_require_approval=true` → new venue created by human lands in `pending`.
- Pending venues do NOT appear in portal list.
- Admin PATCH to `status=active` transitions the venue.
- `can_publish_event=admin_only` blocks humans from publishing events directly.

## E2E flows (pending)

### Backoffice

1. **Recurring event edit/cancel**
   - Login as admin → navigate to events → click "New event".
   - Fill form, pick venue, set RRULE WEEKLY on Tue/Thu for 4 weeks, publish.
   - Open one occurrence → edit title → save (override is created).
   - Delete series → both the master and the override disappear.

2. **Venue collision**
   - Create venue with weekly_hours Mon–Fri 09:00–17:00.
   - Add exception: closed 12:00–14:00 on Monday.
   - Try to schedule event 11:30–13:00 on that Monday → `AvailabilityIndicator` must show red, and save must 409.

### Portal

3. **Human RSVP + cancel**
   - Login as human → open event detail → click Register.
   - Assert toast + participant count increments.
   - Assert mock inbox received iTIP REQUEST with correct ICS.
   - Cancel RSVP → mock inbox receives iTIP CANCEL.

## DB invariants (to add to CI as SQL checks post-migration)

```sql
-- An event is not a master and an override at the same time.
SELECT id FROM events
WHERE rrule IS NOT NULL AND recurrence_master_id IS NOT NULL;

-- Every override points to a master that is actually a master.
SELECT o.id FROM events o
LEFT JOIN events m ON m.id = o.recurrence_master_id
WHERE o.recurrence_master_id IS NOT NULL
  AND (m.id IS NULL OR m.rrule IS NULL);

-- Participant: checked_in implies check_time is set.
SELECT id FROM event_participants
WHERE status = 'checked_in' AND check_time IS NULL;

-- Participant: registered/checked_in implies registered_at is set.
SELECT id FROM event_participants
WHERE status IN ('registered', 'checked_in') AND registered_at IS NULL;

-- Active participants per event never exceed max_participant.
SELECT e.id
FROM events e
JOIN (
    SELECT event_id, COUNT(*) AS c
    FROM event_participants
    WHERE status IN ('registered', 'checked_in')
    GROUP BY event_id
) p ON p.event_id = e.id
WHERE e.max_participant IS NOT NULL AND p.c > e.max_participant;

-- Weekly hours: 0 or 7 rows per venue; day_of_week unique per venue.
SELECT venue_id FROM venue_weekly_hours
GROUP BY venue_id HAVING COUNT(*) NOT IN (0, 7);
SELECT venue_id, day_of_week FROM venue_weekly_hours
GROUP BY venue_id, day_of_week HAVING COUNT(*) > 1;

-- Active participants are not on cancelled/draft events.
SELECT p.id
FROM event_participants p JOIN events e ON e.id = p.event_id
WHERE p.status IN ('registered', 'checked_in')
  AND e.status IN ('cancelled', 'draft');

-- Venue photos per venue never exceed 10.
SELECT venue_id FROM venue_photos GROUP BY venue_id HAVING COUNT(*) > 10;
```

Each query should return **zero rows** on a healthy database. Wire them into a pytest fixture or a dedicated CI step that runs after migrations.

## Running tests locally

```bash
# Backend integration + unit (requires Docker for testcontainers)
cd backend && uv run pytest -v

# Just the events-related tests
cd backend && uv run pytest -v tests/test_recurrence.py tests/test_venue_availability.py

# Ruff (backend)
cd backend && uv run ruff check .
```

Cold pytest run: ~60s (Postgres container startup + Alembic migrations). Warm: ~5s.

## CI

`.github/workflows/ci.yml` runs on every PR and on `push` to `main`:

- `backend` job: `ruff check .` + `pytest -v` (uses `uv sync --dev`, GitHub-hosted Ubuntu, Docker pre-installed for testcontainers).

**Not yet in CI** (follow-ups):

- Frontend lint/typecheck (biome + tsc for backoffice + portal).
- E2E Playwright job (gated on label or scheduled, not every PR).
- DB invariants SQL step.

## Next up

Pick in this order — each stands alone but earlier items deliver more risk reduction per hour:

1. Participant state machine tests (small, high-value — currently untested).
2. iTIP dispatch tests (mock SMTP, snapshot ICS) — prevents calendar duplication bugs in Gmail/Outlook/Apple Mail.
3. Event CRUD + SEQUENCE bumping tests.
4. DB invariants in CI.
5. Frontend lint/typecheck in CI.
6. First E2E (recurring event edit/cancel in backoffice).
