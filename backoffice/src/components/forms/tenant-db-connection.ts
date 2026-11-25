import type { CredentialInfo, TenantCredentialResponse } from "@/client"

export function buildReadonlyConnectionString(
  cred: Pick<CredentialInfo, "db_username" | "db_password">,
  db: Omit<TenantCredentialResponse, "credentials">,
) {
  const user = encodeURIComponent(cred.db_username)
  const password = encodeURIComponent(cred.db_password)
  const tls = db.db_ssl_mode === "verify-full" ? "?sslmode=verify-full" : ""
  return `postgresql://${user}:${password}@${db.db_host}:${db.db_port}/${db.db_name}${tls}`
}
