import type { Metadata } from "next"
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar"
import { resolveTenantForMetadata } from "@/lib/tenant-metadata"
import PortalShell from "./PortalShell"

const FALLBACK_NAME = "Edge Portal"

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await resolveTenantForMetadata()
  const name = tenant?.name ? `${tenant.name} Portal` : FALLBACK_NAME

  return {
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: name,
    },
  }
}

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <ServiceWorkerRegistrar />
      <PortalShell>{children}</PortalShell>
    </>
  )
}
