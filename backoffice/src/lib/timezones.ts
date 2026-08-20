import { COUNTRIES } from "@edgeos/shared-form-ui"

import { TIMEZONE_COUNTRY } from "./timezone-countries.generated"

export interface TimezoneOption {
  /** IANA identifier — what gets stored. */
  id: string
  /** Last path segment, humanised: "Buenos Aires". */
  city: string
  /** Country name for the zone, or null when we have no mapping (UTC). */
  country: string | null
  /** "GMT-3" as of now — DST-dependent, recomputed on module load. */
  offset: string
  /** First path segment, used to group the list: "America". */
  region: string
  /** Diacritic-free lowercase haystack: city, country, id, offset. */
  searchText: string
}

/**
 * ICU still answers with the historical name for these zones, so
 * `Intl.supportedValuesOf("timeZone")` — and therefore the generated country
 * table — carries e.g. `Asia/Calcutta` rather than `Asia/Kolkata`. We show and
 * store the identifier IANA prefers; the old one stays searchable and any
 * value already saved under it resolves to the same option.
 *
 * Lives here rather than in the generated file so re-running the generator
 * never drops the curation.
 */
const PREFERRED_ID: Record<string, string> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
}

/** Preferred id → the historical id it replaced, for search + lookup. */
const LEGACY_ID: Record<string, string> = Object.fromEntries(
  Object.entries(PREFERRED_ID).map(([legacy, preferred]) => [
    preferred,
    legacy,
  ]),
)

const COUNTRY_NAME: Record<string, string> = Object.fromEntries(
  COUNTRIES.map(({ code, name }) => [code, name]),
)

/** Lowercase and strip diacritics so "bogota" finds "Bogotá". */
export function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim()
}

/** "GMT-3" for the given zone right now, or "" if the runtime rejects it. */
export function gmtOffset(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date())
    return parts.find((p) => p.type === "timeZoneName")?.value ?? ""
  } catch {
    return ""
  }
}

/** Rewrites a historical identifier onto the one we list. */
export function canonicalizeTimezone(id: string): string {
  return PREFERRED_ID[id] ?? id
}

function buildOption(
  id: string,
  countryCode: string | undefined,
): TimezoneOption {
  const segments = id.split("/")
  const city = (segments[segments.length - 1] || id).replace(/_/g, " ")
  const region = segments.length > 1 ? segments[0] : "Other"
  const country = countryCode ? (COUNTRY_NAME[countryCode] ?? null) : null
  const offset = gmtOffset(id)
  const legacy = LEGACY_ID[id]

  return {
    id,
    city,
    country,
    offset,
    region,
    searchText: normalizeSearch(
      [
        city,
        country ?? "",
        id,
        id.replace(/[/_]/g, " "),
        legacy ? legacy.replace(/[/_]/g, " ") : "",
        offset,
      ].join(" "),
    ),
  }
}

let cachedOptions: TimezoneOption[] | null = null

/**
 * Every canonical IANA zone plus UTC, sorted by region then city.
 *
 * Building it means ~420 `Intl.DateTimeFormat` constructions (~60 ms), so it
 * is lazy and memoised for the lifetime of the module.
 */
export function getTimezoneOptions(): TimezoneOption[] {
  if (cachedOptions) return cachedOptions

  // ICU's zone list has no entry for UTC, but it is the default we ship and
  // the sanest pick for a gathering that spans regions.
  const options = [buildOption("UTC", undefined)]
  for (const [rawId, countryCode] of Object.entries(TIMEZONE_COUNTRY)) {
    options.push(buildOption(canonicalizeTimezone(rawId), countryCode))
  }

  options.sort(
    (a, b) => a.region.localeCompare(b.region) || a.city.localeCompare(b.city),
  )
  cachedOptions = options
  return options
}

/** The zone the browser reports, or null when it is unavailable/unknown. */
export function getBrowserTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz ? canonicalizeTimezone(tz) : null
  } catch {
    return null
  }
}

/**
 * An entry for a value we do not list — a legacy row, or a zone this browser's
 * tzdata does not know. Keeps the trigger populated so opening and closing the
 * picker cannot silently drop the saved value.
 */
export function syntheticTimezoneOption(id: string): TimezoneOption {
  return buildOption(id, undefined)
}

/** Trigger text: "Europe/Madrid (GMT+2)". */
export function formatTimezoneLabel(id: string): string {
  const offset = gmtOffset(id)
  return offset ? `${id} (${offset})` : id
}
