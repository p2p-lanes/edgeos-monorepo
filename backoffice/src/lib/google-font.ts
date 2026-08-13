/**
 * Google Fonts helpers for the theme editor's font picker.
 *
 * Deliberately mirrors `portal/src/lib/google-font.ts`: the two apps are
 * separate builds with no shared runtime package, and the rule that decides
 * which family names are safe has to be identical on both sides — the
 * backoffice writes the value, the portal renders it. Keep them in sync.
 */

/** See the portal copy for why this is an allowlist rather than an escape. */
const FAMILY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ]{0,48}$/

const CSS_BASE = "https://fonts.googleapis.com/css2"

export function isValidFontFamily(value: unknown): value is string {
  return typeof value === "string" && FAMILY_PATTERN.test(value.trim())
}

function normalize(family: string): string {
  return family.trim().replace(/\s+/g, " ")
}

/**
 * Stylesheet URL for previewing a batch of families in the picker list.
 *
 * Only weight 400 — the picker shows one line of text per family, and asking
 * for four weights across a screenful of rows would multiply the download for
 * no visible gain. The portal asks for the full range separately.
 */
export function buildPreviewStylesheetUrl(
  families: readonly string[],
): string | null {
  const unique = Array.from(
    new Set(families.filter(isValidFontFamily).map(normalize)),
  )
  if (unique.length === 0) return null

  const params = unique
    .map((family) => `family=${family.replace(/ /g, "+")}:wght@400`)
    .join("&")
  return `${CSS_BASE}?${params}&display=swap`
}

/** CSS `font-family` value for rendering a preview, or null if unsafe. */
export function toCssFontFamily(family: string): string | null {
  if (!isValidFontFamily(family)) return null
  return `"${normalize(family)}", system-ui, sans-serif`
}
