import type { AxiosRequestConfig } from "axios"

/** A captured request tenant must not be replaced after an async auth lookup. */
export function withWorkspaceTenant(
  config: AxiosRequestConfig,
  tenantId: string | null,
) {
  if (
    tenantId &&
    !config.headers?.["X-Tenant-Id"] &&
    !config.headers?.["x-tenant-id"]
  ) {
    config.headers = { ...config.headers, "X-Tenant-Id": tenantId }
  }
  return config
}
