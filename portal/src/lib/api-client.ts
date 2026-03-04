import { OpenAPI } from "@/client"

OpenAPI.BASE = process.env.NEXT_PUBLIC_API_URL ?? ""

OpenAPI.TOKEN = async () => {
  if (typeof window !== "undefined") {
    return localStorage.getItem("token") ?? ""
  }
  return ""
}

OpenAPI.interceptors.request.use((config) => {
  const tenantId = localStorage.getItem("portal_tenant_id")
  if (tenantId) {
    config.headers = { ...config.headers, "X-Tenant-Id": tenantId }
  }
  const language = localStorage.getItem("portal_language")
  if (language && language !== "en") {
    config.headers = { ...config.headers, "Accept-Language": language }
  }
  return config
})

/** @deprecated No-op — API client auto-configures on import. Kept for checkout compat. */
export function configureApiClient(_token?: string) {}
