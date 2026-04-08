"use client"

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react"
import type { TenantPublic } from "@/client"
import { ApiError, TenantsService } from "@/client"
import "@/lib/api-client"
import { extractSubdomain } from "@/lib/tenant"
import { resolveHostname } from "@/lib/tenant-resolution"

const TENANT_STORAGE_KEY = "portal_tenant_id"

interface TenantContextValue {
  tenantId: string | null
  tenantSlug: string | null
  tenant: TenantPublic | null
  isLoading: boolean
  error: string | null
}

const TenantContext = createContext<TenantContextValue | null>(null)

interface TenantProviderProps {
  children: ReactNode
  /**
   * Pre-resolved tenant ID from the middleware (custom domain path only).
   * When provided, the client-side by-domain API call is skipped.
   */
  initialTenantId?: string | null
  /**
   * Pre-resolved tenant slug from the middleware (custom domain path only).
   * When provided alongside `initialTenantId`, the client-side by-domain
   * API call is skipped and a cheaper by-slug call is made instead.
   */
  initialTenantSlug?: string | null
}

export const TenantProvider = ({
  children,
  initialTenantId = null,
  initialTenantSlug = null,
}: TenantProviderProps) => {
  const [tenant, setTenant] = useState<TenantPublic | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [slug, setSlug] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return

    // If the proxy already resolved the tenant server-side, use those headers
    // directly — no custom domain logic needed on the client.
    if (initialTenantId && initialTenantSlug) {
      localStorage.setItem(TENANT_STORAGE_KEY, initialTenantId)
      TenantsService.getTenantBySlug({ slug: initialTenantSlug })
        .then((result) => {
          setTenant(result)
          setSlug(result.slug)
        })
        .catch((err) => {
          if (err instanceof ApiError && err.status === 404) {
            setError("Site not found")
          } else {
            setError("Failed to resolve tenant")
          }
          localStorage.removeItem(TENANT_STORAGE_KEY)
        })
        .finally(() => {
          setIsLoading(false)
        })
      return
    }

    // Subdomain path: extract slug from hostname.
    const hostname = window.location.hostname
    const { slug: resolvedSlug } = resolveHostname(hostname)
    const extracted = resolvedSlug ?? extractSubdomain(hostname)
    setSlug(extracted)

    if (!extracted) {
      setError("Unable to determine tenant from domain")
      setIsLoading(false)
      return
    }

    TenantsService.getTenantBySlug({ slug: extracted })
      .then((result) => {
        setTenant(result)
        localStorage.setItem(TENANT_STORAGE_KEY, result.id)
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setError(`Tenant "${extracted}" not found`)
        } else {
          setError("Failed to resolve tenant")
        }
        localStorage.removeItem(TENANT_STORAGE_KEY)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [initialTenantId, initialTenantSlug])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-neutral-100">
        <div className="animate-spin h-8 w-8 border-4 border-gray-300 border-t-gray-900 rounded-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 px-4">
        <div className="text-center max-w-lg">
          <div className="mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-gray-200">
            <svg
              aria-hidden="true"
              className="h-12 w-12 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Site not available
          </h1>
          <p className="mt-3 text-lg text-gray-500">
            The address you entered doesn't match any registered site. Please
            check the URL and try again.
          </p>
        </div>
      </div>
    )
  }

  return (
    <TenantContext.Provider
      value={{
        tenantId: tenant?.id ?? null,
        tenantSlug: slug,
        tenant,
        isLoading,
        error,
      }}
    >
      {children}
    </TenantContext.Provider>
  )
}

export function useTenant(): TenantContextValue {
  const context = useContext(TenantContext)
  if (!context) {
    throw new Error("useTenant must be used within a TenantProvider")
  }
  return context
}
