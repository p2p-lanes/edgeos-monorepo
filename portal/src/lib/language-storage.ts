// Single source of truth for the portal language localStorage key. Shared by
// the language provider (writer) and the API client interceptor (reader) so the
// two can never drift apart and silently stop sending the Accept-Language
// header, which is what previously broke dynamic translations end to end.
export const LANGUAGE_STORAGE_KEY = "portal_language_v2"

// In-memory mirror of the language currently on screen, set synchronously by
// the language provider whenever the resolved language changes. The API client
// interceptor reads this first so a mid-session switch sends the right
// Accept-Language even before the ?lang URL navigation has landed — the URL
// lags a client-side switch, and reading it there would refetch dynamic
// content in the previous language. Stays null until the provider mounts, so
// first-render / deep-link requests still fall back to the URL param.
let activeRequestLanguage: string | null = null

export function setActiveRequestLanguage(language: string | null): void {
  activeRequestLanguage = language
}

export function getActiveRequestLanguage(): string | null {
  return activeRequestLanguage
}
