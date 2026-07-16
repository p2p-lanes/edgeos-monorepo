import { OpenAPI } from "@/client"
import { LANGUAGE_STORAGE_KEY } from "@/lib/language-storage"

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
  // Prefer the ?lang (or ?locale) URL param, then the stored language. The URL
  // is available synchronously on the first render, before the language
  // provider persists the choice to localStorage in an effect. Reading only
  // localStorage raced that write: the first runtime request went out without
  // Accept-Language and returned the popup default, so a ?lang=en deep link
  // showed the source language until a later refetch (e.g. on window focus).
  // The backend overlay is default-agnostic, so sending the default (or an
  // unsupported value) simply finds no translations and returns the source.
  const params = new URLSearchParams(window.location.search)
  const language =
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
