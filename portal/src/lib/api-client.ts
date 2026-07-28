import { OpenAPI } from "@/client"
import {
  getActiveRequestLanguage,
  LANGUAGE_STORAGE_KEY,
} from "@/lib/language-storage"

if (!process.env.NEXT_PUBLIC_API_URL) {
  throw new Error("NEXT_PUBLIC_API_URL is not configured")
}

OpenAPI.BASE = process.env.NEXT_PUBLIC_API_URL

OpenAPI.TOKEN = async () => {
  if (typeof window !== "undefined") {
    return localStorage.getItem("token") ?? ""
  }
  return ""
}

OpenAPI.interceptors.request.use((config) => {
  // `localStorage` only exists in the browser. During SSR (e.g. checkout
  // `generateMetadata`) this interceptor still runs, so guard the access or it
  // throws `ReferenceError` and the caller silently falls back to null.
  if (typeof window === "undefined") {
    return config
  }
  const tenantId = localStorage.getItem("portal_tenant_id")
  if (tenantId) {
    config.headers = { ...config.headers, "X-Tenant-Id": tenantId }
  }
  // Prefer the language the provider is currently showing (set synchronously
  // on switch), then the ?lang/?locale URL param, then the stored language.
  // The in-memory value wins because a mid-session switch updates the UI before
  // its ?lang navigation lands — reading the URL there would refetch dynamic
  // content in the previous language. It stays null until the provider mounts,
  // so the first render / a ?lang deep link still resolves via the URL param
  // (reading only localStorage raced the provider's write and dropped the
  // header on the first runtime request). The backend overlay is
  // default-agnostic, so an unsupported value simply returns the source.
  const params = new URLSearchParams(window.location.search)
  const language =
    getActiveRequestLanguage() ||
    params.get("lang") ||
    params.get("locale") ||
    localStorage.getItem(LANGUAGE_STORAGE_KEY)
  if (language) {
    config.headers = { ...config.headers, "Accept-Language": language }
  }
  return config
})

/** @deprecated No-op — API client auto-configures on import. Kept for checkout compat. */
export function configureApiClient(_token?: string) {}
