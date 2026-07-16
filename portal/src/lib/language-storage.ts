// Single source of truth for the portal language localStorage key. Shared by
// the language provider (writer) and the API client interceptor (reader) so the
// two can never drift apart and silently stop sending the Accept-Language
// header, which is what previously broke dynamic translations end to end.
export const LANGUAGE_STORAGE_KEY = "portal_language_v2"
