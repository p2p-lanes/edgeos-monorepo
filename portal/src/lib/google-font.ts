/**
 * Google Fonts loading for admin-configured theme fonts.
 *
 * The family name arrives from `popup.theme_config.typography` — i.e. from the
 * database — and ends up interpolated into both a URL and a CSS declaration.
 * Everything here treats it as untrusted input.
 */

/**
 * Google family names are letters, digits and single spaces (e.g. "Playfair
 * Display", "Noto Sans JP"). Anything else is rejected rather than escaped:
 * an escape that misses turns into CSS injection, whereas a rejected name just
 * falls back to the portal default.
 *
 * The length cap is well above the longest real family (~40 chars) and keeps a
 * pathological value out of the URL.
 */
const FAMILY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ]{0,48}$/

/**
 * Weights requested for every family. Google silently serves the subset a
 * family actually publishes — a regular-only family like Amarante returns 200
 * and just the 400 face — so there is no need to know the variants up front.
 */
const WEIGHTS = "wght@400;500;600;700"

const CSS_BASE = "https://fonts.googleapis.com/css2"

export function isValidFontFamily(value: unknown): value is string {
  return typeof value === "string" && FAMILY_PATTERN.test(value.trim())
}

/** Normalise to the form used in both the URL and the CSS value. */
function normalize(family: string): string {
  return family.trim().replace(/\s+/g, " ")
}

/**
 * Build the stylesheet URL for the given families, or null when none are
 * usable. Both families ride in a single request — one round trip, one
 * render-blocking stylesheet.
 *
 * Not using `URLSearchParams`: it percent-encodes the `;` weight separator and
 * the `:` axis marker, which Google's parser rejects. The inputs are already
 * constrained to `[A-Za-z0-9 ]`, so manual assembly is safe here.
 */
export function buildGoogleFontsUrl(
  families: readonly (string | undefined)[],
): string | null {
  // The Set asks for each family once even when body and headings share it.
  const unique = Array.from(
    new Set(families.filter(isValidFontFamily).map(normalize)),
  )
  if (unique.length === 0) return null

  const params = unique
    .map((family) => `family=${family.replace(/ /g, "+")}:${WEIGHTS}`)
    .join("&")
  return `${CSS_BASE}?${params}&display=swap`
}

/**
 * CSS `font-family` value for a validated family, with a fallback stack so
 * text stays readable while the webfont is in flight (or if it never loads).
 */
export function toCssFontFamily(family: string): string | null {
  if (!isValidFontFamily(family)) return null
  return `"${normalize(family)}", system-ui, sans-serif`
}
