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
