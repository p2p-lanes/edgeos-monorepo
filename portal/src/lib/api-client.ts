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
  // Send the selected language whenever one is stored, regardless of which
  // language it is. The backend overlay is default-agnostic: if the requested
  // language matches the popup default it simply finds no translation rows and
  // returns the source. Special-casing "en" here broke Spanish-default popups.
  const language = localStorage.getItem(LANGUAGE_STORAGE_KEY)
  if (language) {
    config.headers = { ...config.headers, "Accept-Language": language }
  }
  return config
})

/** @deprecated No-op — API client auto-configures on import. Kept for checkout compat. */
export function configureApiClient(_token?: string) {}
