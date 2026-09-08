import { headers } from "next/headers"
import { type ServerTenant, trustedOrigin } from "@/lib/server/tenant"
import { getServerTenant } from "./server/bootstrap"

/** Resolve the active tenant for SSR metadata (root layout, share previews). */
export async function resolveTenantForMetadata(): Promise<ServerTenant | null> {
  try {
    return await getServerTenant()
  } catch {
    return null
  }
}

/** Absolute site origin for metadataBase (og:url resolution). */
export async function getMetadataBase(): Promise<URL | undefined> {
  try {
    return new URL(trustedOrigin(new Headers(await headers())))
  } catch {
    return undefined
  }
}
