/**
 * Format an ISO datetime string as a localized relative time
 * ("hace 2 h", "2 hours ago", "2小时前") using Intl.RelativeTimeFormat.
 *
 * Picks the largest unit whose value is >= 1 so we never produce
 * "3600 seconds ago" when "1 hour ago" would do. Past times produce
 * negative values; future times produce positive values. Returns an
 * empty string if the input cannot be parsed.
 */
export function formatRelative(iso: string, locale: string): string {
  const target = new Date(iso).getTime()
  if (Number.isNaN(target)) return ""

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  const diffSec = (target - Date.now()) / 1000
  const absSec = Math.abs(diffSec)

  if (absSec < 60) {
    return rtf.format(Math.round(diffSec), "second")
  }
  if (absSec < 3600) {
    return rtf.format(Math.round(diffSec / 60), "minute")
  }
  if (absSec < 86400) {
    return rtf.format(Math.round(diffSec / 3600), "hour")
  }
  return rtf.format(Math.round(diffSec / 86400), "day")
}
