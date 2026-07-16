"use client"

/**
 * Marketing attribution captured from the checkout entry URL.
 *
 * The params (utm_*, fbclid, landing_segment, anonymous_id) arrive on the entry
 * URL but the URL is lost as the buyer moves through checkout steps, so we
 * persist them in localStorage on entry and read them back at purchase time.
 * Generic capability — not partner-specific. `anonymous_id` is what a partner
 * uses to tie the purchase back to its web session.
 */

const STORAGE_KEY = "edgeos_attribution_v1"

const ATTRIBUTION_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "fbclid",
  "landing_segment",
  "anonymous_id",
] as const

type AttributionKey = (typeof ATTRIBUTION_KEYS)[number]
export type Attribution = Partial<Record<AttributionKey, string>>

interface ReadableParams {
  get(key: string): string | null
}

/**
 * Merge any attribution params present in the URL into the stored blob.
 * Non-empty values win; missing params never clear previously captured ones.
 */
export function captureAttribution(params: ReadableParams): void {
  if (typeof window === "undefined") return

  const stored = getAttribution()
  let changed = false
  for (const key of ATTRIBUTION_KEYS) {
    const value = params.get(key)
    if (value && stored[key] !== value) {
      stored[key] = value
      changed = true
    }
  }

  if (changed) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    } catch {
      // localStorage unavailable (private mode / SSR) — attribution is best-effort.
    }
  }
}

/** Read the captured attribution blob (empty object when none/unavailable). */
export function getAttribution(): Attribution {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Attribution) : {}
  } catch {
    return {}
  }
}
