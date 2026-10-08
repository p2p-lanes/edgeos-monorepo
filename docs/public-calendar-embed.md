# Public calendar links and embeds

The anonymous calendar lives at `https://<tenant-domain>/<popup-slug>/calendar`
(no `/portal` prefix). Use the tenant's active custom domain when configured.

## Initial view

The `view` query parameter accepts:

- `calendar`: month grid and selected-day event panel.
- `day`: day-by-venue schedule.
- `list`: upcoming events list (the default).

Missing or invalid values fall back to `list`. Changing the view updates this
parameter while preserving other query parameters, without scrolling the page.

```html
<iframe
  src="https://<tenant-slug>.edgeos.world/<popup-slug>/calendar?view=calendar"
  title="Events calendar"
  width="100%"
  height="800"
  style="border: 0; border-radius: 12px;"
  loading="lazy"
></iframe>
```

This embeds the full public page, not a separate widget. Deployment headers must
allow iframe embedding on the host website.

## Initial day

Grid and day views choose the initial day using the gathering's timezone:

- Before the popup's start date: the first day with a published, public event.
- After its end date, or with status `ended`: the last day with such an event.
- During the popup: today.
- Empty schedules or unknown dates: today.

Popup dates are nominal calendar dates; the end day is inclusive. Event days
are derived from their start times, including expanded recurring occurrences.
Search/tag/track filters do not change the default day. Manually selected days
are preserved when data refreshes.

The API accepts active and ended popups; draft, archived, and other tenants'
popups remain opaque 404s. Only published, public events are returned. The
frontend fetches every page so schedules with more than 200 events aren't cut
off. Without explicit request bounds, the API uses the popup's date range. If
only one boundary is known, it uses a 181-day window anchored to that boundary;
bounded ranges expand beyond the usual 100-occurrence soft cap when needed,
while retaining the global recurrence safety cap.

The list stays upcoming-only for ongoing/future popups. For ended popups it
shows the historical schedule.

## Local QA fixtures

With the local Docker stack running and the backend image up to date:

```bash
docker compose exec backend alembic upgrade head
docker compose exec backend python scripts/seed_public_calendar_qa.py
```

The seeder refuses non-development environments and non-local database hosts.
It uses deterministic IDs to create/update only dedicated `qa-public-calendar-*`
popups in the existing `demo` tenant; it does not alter the normal demo popups.
Running it again updates the same fixtures without adding duplicates. No
notifications or external APIs are called. `--base-date YYYY-MM-DD` makes the
fixture dates reproducible; otherwise dates are relative to today in Buenos Aires.
The printed JSON includes each URL, expected initial day, and public event count.

Fixtures at `http://demo.localhost:3000`:

| Popup slug | Scenario |
| --- | --- |
| `qa-public-calendar-future` | More than 180 days away; first event two days after popup start, at 23:30 local |
| `qa-public-calendar-ongoing` | Yesterday, today, and tomorrow; today selected |
| `qa-public-calendar-ended` | 320 expanded public events, including a 115-occurrence daily series; last event two days before popup end |
| `qa-public-calendar-empty` | No events; today fallback |
| `qa-public-calendar-new-year` | UTC+14; first event January 1 locally, December 31 in UTC |

For each slug, open `/<slug>/calendar?view=calendar` or `?view=day`.
Non-empty fixtures also include private, unlisted, draft, and cancelled events
whose titles end in `MUST NOT LEAK`; none should appear in the public feed.

### Browser validation (2026-10-08)

Validated the PR's Docker backend + production portal against the local mock DB:

- Future grid opened on **2027-06-07**, ongoing on **2026-10-08**, and ended on
  **2026-09-26**. Both grid and day links selected the expected day.
- Ended popup fetched two API pages (**200 + 120**), reaching its final recurring
  occurrence beyond the old 100-occurrence soft cap.
- UTC+14 grid opened on **2027-01-01**, not the event's UTC date in 2026.
- Empty popup fell back to today; invalid view fell back to list.
- Grid/day manual navigation survived search filtering; view changes preserved
  the unrelated `source=embed` URL parameter.
- A real iframe hosted on **localhost:8090** loaded the grid from
  **demo.localhost:3000** without frame/CORS errors.
- Mobile viewport **390 × 844** had no horizontal overflow; no browser JS errors
  were observed in the tested pages.
- Re-running the seeder produced the same manifest and no duplicate records;
  the three original demo popups retained their original dates/statuses.

Local evidence (not committed): `dogfood-output/public-calendar-qa/` contains
fixtures, API results, desktop/mobile/iframe screenshots, and a pre-QA DB backup.
