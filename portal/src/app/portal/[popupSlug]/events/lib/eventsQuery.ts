// The portal events views are each bounded by a date range — the list's popup
// window, the calendar's month, the day view's day. That range is the real
// limit on how many events come back. The API still requires a `limit` and
// caps it at 1000, so we pass that ceiling instead of an arbitrary lower
// number: within any realistic range the result set sits well below it, and a
// range that genuinely held more than 1000 events would overwhelm these views
// regardless. The range is the bound; this is just the API's required maximum.
export const EVENTS_QUERY_LIMIT = 1000
