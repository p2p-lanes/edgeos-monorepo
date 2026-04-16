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
| Event CRUD + recurrence/overrides | `backend/tests/test_event_crud.py`    | done (12 cases) |
| Participant state machine      | `backend/tests/test_event_participants.py` | done (17 cases; 1 concurrency case skipped) |
| iTIP dispatch (REQUEST/UPDATE/CANCEL) + SEQUENCE bumps | `backend/tests/test_event_itip.py` | done (20 cases) |
| Approval flow (venues/events)  | `backend/tests/test_events_approval.py`  | done (12 cases) |
| Event invitations + dedup      | covered inside `test_event_itip.py` (`gather_event_recipients` + bulk invite) | done |

### E2E (Playwright, `e2e/` workspace package)

Scaffolded with desktop + mobile projects (iPhone 13); no visual baselines — assertions are functional (`getByRole`, `toBeInViewport`, etc.). Real login via Mailpit + JWT injection; seeds via backend admin API.

| Flow                                                              | Target   | Status |
| ----------------------------------------------------------------- | -------- | ------ |
| Human RSVPs → cancels RSVP (runs on both viewports)               | `portal/rsvp.spec.ts` | done (scaffolded; needs local stack to run) |
| Admin sees seeded event in events list (smoke)                    | `backoffice/recurring-event.spec.ts` | done (scaffolded) |
| Admin creates recurring event → edits one occurrence → cancels series | backoffice | pending (UI-driven form flow) |
| Admin creates venue with weekly hours + exception → schedules event that collides | backoffice | pending |

### DB invariants (not started)

See "Invariants" section below for the SQL checks to run post-migration in CI.

## Integration test cases (pending — planned)

### Event CRUD + recurrence/overrides (done — `test_event_crud.py`)

Covered:

- POST /events defaults to DRAFT + empty rrule/exdates.
- POST /events with `recurrence` serializes the canonical RRULE.
- PATCH /events/{id}/recurrence sets, replaces, and clears the rule; clearing wipes stale EXDATEs.
- PATCH /events/{id}/recurrence on a detached occurrence → 400.
- POST /events/{id}/detach-occurrence builds a child with `recurrence_master_id` set, no `rrule`, same duration; appends EXDATE to the master.
- POST /events/{id}/detach-occurrence on a non-recurring event → 400.
- DELETE /events/{id}/occurrence appends EXDATE without dropping the master; non-recurring → 400.
- GET /events with start_after / start_before expands a series into the master + pseudo occurrences (distinguished via `occurrence_id`).
- Overrides suppress the pseudo-row for their own date.
- EXDATEs suppress a pseudo without breaking the rest of the series.

### iTIP dispatch + SEQUENCE (done — `test_event_itip.py`)

Covered:

- `build_event_ics` emits METHOD/SEQUENCE/UID/ATTENDEE/ORGANIZER lines correctly for REQUEST vs CANCEL.
- DTSTART/DTEND are always UTC (`Z`) regardless of `event.timezone`; Buenos Aires 11:00 → 14:00Z.
- TEXT-value escaping (commas / semicolons) in SUMMARY.
- `gather_event_recipients` dedupes invited + participant overlap; excludes cancelled participants.
- `calendar_fields_changed` flags title/start/end/venue changes; ignores description/visibility.
- Bulk invite fires a single REQUEST dispatch with all new recipients; duplicate invites return `skipped_existing` with no new recipients.
- PATCH of a calendar field bumps `ical_sequence` and re-sends REQUEST to the full recipient set.
- PATCH of a non-calendar field leaves `ical_sequence` and dispatch untouched.
- /cancel bumps SEQUENCE, flips status, fires CANCEL (and blocks double-cancel with 400).
- DELETE /events/{id} emits CANCEL with the bumped SEQUENCE before the row is dropped.

### Participants (done — `test_event_participants.py`)

Covered:

- Portal register on PUBLISHED event → REGISTERED row + iTIP REQUEST to the registering human only.
- Portal register on DRAFT / CANCELLED event → 400.
- Duplicate active registration → 409.
- `max_participant` enforced at registration time (409 "full") — single-client sequential.
- Portal re-register after cancel reactivates the same row, updates `registered_at`.
- Portal cancel → CANCELLED, `registered_at` preserved, iTIP CANCEL fired.
- Portal cancel without / after cancel → 404.
- Portal check-in: REGISTERED → CHECKED_IN + `check_time` stamped.
- Portal check-in with no / cancelled registration → 404; double check-in → 400.
- Admin POST add, conflict on active, reactivate on cancelled, DELETE.

Skipped / open:

- True concurrent registration race (two parallel clients + row lock) — placeholder `test_concurrent_registrations_respect_max_participant`. Needs `SELECT ... FOR UPDATE` in `register_for_event` before it can be made deterministic.
- Reverse transitions via backoffice PATCH (`checked_in → registered` etc.) are currently unrestricted by design — admin override. Revisit if product wants to enforce them.

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

### Approval flow (done — `test_events_approval.py`)

Covered:

- Portal venue POST blocked when `humans_can_create_venues=false` (403).
- Portal venue POST with `humans_can_create_venues=true` + `venues_require_approval=true` → `status=pending`.
- Portal venue POST with approval disabled → `status=active`.
- `GET /event-venues/portal/venues` hides pending venues; admin PATCH to `active` promotes them into the portal listing.
- Portal event POST blocked when `event_enabled=false` (403).
- Portal event POST with `can_publish_event=admin_only` + `status=published` → 403; same settings allow `status=draft`.
- Venue with `booking_mode=approval_required` forces `status=PENDING_APPROVAL` + `visibility=UNLISTED` regardless of payload.
- POST `/events/{id}/approve` on pending → `PUBLISHED` + `PUBLIC`; POST `/events/{id}/reject` → `REJECTED`.
- Both endpoints reject non-pending events with 400.

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

-- Weekly hours: day_of_week unique per venue. (The "0 or 7 rows per
-- venue" rule that appeared in an earlier draft is a UI convention, not
-- a DB invariant: the PUT /weekly-hours endpoint accepts any subset.)
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

- `backend` job: `ruff check .` + `pytest -v`. DB-invariants file (`test_zz_db_invariants.py`) runs last in alphabetic order as a post-suite audit against the accumulated test DB.
- `frontend` job: `biome ci` + `tsc --noEmit` on both backoffice and portal. Uses pnpm 9.15.4 + Node 20 with pnpm-store cache.

**Not yet in CI** (follow-ups):

- E2E Playwright job (gated on label or scheduled, not every PR) — also the first opportunity to wire viewport projects (desktop + mobile via `devices['iPhone 13']`) instead of only-desktop coverage.

## Next up

Pick in this order — each stands alone but earlier items deliver more risk reduction per hour:

1. ~~Participant state machine tests~~ — done (`test_event_participants.py`).
2. ~~iTIP dispatch tests (mock SMTP, snapshot ICS)~~ — done (`test_event_itip.py`).
3. ~~Event CRUD + SEQUENCE bumping tests~~ — split across `test_event_crud.py` (CRUD + overrides) and `test_event_itip.py` (SEQUENCE).
4. ~~Approval flow tests~~ — done (`test_events_approval.py`).
5. ~~DB invariants in CI~~ — done (`test_zz_db_invariants.py`, runs as part of the normal pytest job).
6. ~~Frontend lint/typecheck in CI~~ — done (`frontend` job in `.github/workflows/ci.yml`).
7. ~~First E2E~~ — done. Playwright scaffolded under `e2e/` with `portal-desktop` / `portal-mobile` / `backoffice-desktop` projects. Two tests live (portal RSVP + backoffice smoke). Running them requires the local dev stack up — see `e2e/README.md`.
8. Wire Playwright into CI as a separate job (skipped on draft PRs / gated on label) that brings up `docker compose` + installs browsers before running.

## Running locally with one command

```bash
pnpm check
```

Runs, in parallel: backend ruff + pytest, backoffice biome + tsc, portal biome + tsc, E2E (Playwright — auto-starts portal/backoffice dev servers, assumes docker compose up). Total ~82s cold. Use `pnpm check:backend` / `:backoffice` / `:portal` / `:e2e` to run one lane.
