// Single source of truth for the portal language localStorage key. Shared by
// the language provider (writer) and the API client interceptor (reader) so the
// two can never drift apart and silently stop sending the Accept-Language
// header, which is what previously broke dynamic translations end to end.
export const LANGUAGE_STORAGE_KEY = "portal_language_v2"

// Server-readable mirror of the same value. localStorage does not exist during
// SSR, so without this the checkout server render fetched /runtime with no
// Accept-Language and shipped the source-language copy — the visitor saw the
// popup's source language until a client refetch happened to land (up to the
// 30s staleTime later) and swapped the whole page under them.
export const LANGUAGE_COOKIE_KEY = "portal_language"

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

// In-memory mirror of the language currently on screen, set synchronously by
// the language provider whenever the resolved language changes. The API client
// interceptor reads this first so a mid-session switch sends the right
// Accept-Language even before the ?lang URL navigation has landed — the URL
// lags a client-side switch, and reading it there would refetch dynamic
// content in the previous language. Stays null until the provider mounts, so
// first-render / deep-link requests still fall back to the URL param.
let activeRequestLanguage: string | null = null

const requestLanguageListeners = new Set<() => void>()

export function setActiveRequestLanguage(language: string | null): void {
  if (activeRequestLanguage === language) return
  activeRequestLanguage = language
  for (const listener of requestLanguageListeners) {
    listener()
  }
}

export function getActiveRequestLanguage(): string | null {
  return activeRequestLanguage
}

/**
 * Subscribe to changes of the on-screen language. Lets language-dependent
 * query keys re-key on a mid-session switch instead of caching the new
 * language's payload under the previous language's key.
 */
export function subscribeRequestLanguage(listener: () => void): () => void {
  requestLanguageListeners.add(listener)
  return () => {
    requestLanguageListeners.delete(listener)
  }
}

/**
 * Base subtag, lowercased ("es-AR" → "es", "en-US,en;q=0.9" → "en").
 *
 * The backend already reduces Accept-Language to its base subtag, so this only
 * keeps the *client* self-consistent: without it `?lang=en-US` and a stored
 * `en` would produce two different query keys for byte-identical responses.
 */
export function normalizeLanguageTag(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null
  const base = raw.trim().toLowerCase().split(",")[0]?.split("-")[0]
  return base ? base : null
}

/**
 * The language the API client will actually put on the wire, resolved from the
 * same inputs and in the same order as the request interceptor. Query keys for
 * language-dependent endpoints derive from this, so a cache entry can never be
 * labelled with a language other than the one it was fetched in.
 *
 * Returns null during SSR — the server has neither localStorage nor the
 * in-memory mirror, and reads the cookie instead.
 */
export function resolveRequestLanguage(): string | null {
  if (typeof window === "undefined") return null
  const params = new URLSearchParams(window.location.search)
  return normalizeLanguageTag(
    activeRequestLanguage ||
      params.get("lang") ||
      params.get("locale") ||
      localStorage.getItem(LANGUAGE_STORAGE_KEY),
  )
}

/**
 * Persist an explicitly chosen language to both stores.
 *
 * Called only on explicit signals — a manual switch or an incoming ?lang= —
 * never on auto-resolve, so it cannot clobber the popup default_language. The
 * cookie is what makes the *next* server render already correct; localStorage
 * stays the client-side source of truth.
 */
export function persistLanguage(language: string): void {
  if (typeof window === "undefined") return
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  // `secure` would make the cookie a no-op on plain-http local dev.
  const secure = window.location.protocol === "https:" ? "; secure" : ""
  // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is still missing on Firefox and only landed in Safari 18.4; this cookie has to be set on every browser the portal supports
  document.cookie = `${LANGUAGE_COOKIE_KEY}=${encodeURIComponent(
    language,
  )}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax${secure}`
}
