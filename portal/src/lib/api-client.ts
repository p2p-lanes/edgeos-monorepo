import { OpenAPI } from "@/client"

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
  const tenantId = localStorage.getItem("portal_tenant_id")
  if (tenantId) {
    config.headers = { ...config.headers, "X-Tenant-Id": tenantId }
  }
  return config
})

/** @deprecated No-op — API client auto-configures on import. Kept for checkout compat. */
export function configureApiClient(_token?: string) {}
