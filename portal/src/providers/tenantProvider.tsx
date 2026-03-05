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

const TENANT_STORAGE_KEY = "portal_tenant_id"

interface TenantContextValue {
  tenantId: string | null
  tenantSlug: string | null
  tenant: TenantPublic | null
  isLoading: boolean
  error: string | null
}

const TenantContext = createContext<TenantContextValue | null>(null)

function extractSubdomain(hostname: string): string | null {
  // e.g. "edge-city.portal.muvinai.com" -> "edge-city"
  // For local dev, use "edge-city.localhost" which resolves to 127.0.0.1
  const parts = hostname.split(".")
  if (parts.length >= 2 && parts[0] !== "www") {
    return parts[0]
  }

  return null
}

export const TenantProvider = ({ children }: { children: ReactNode }) => {
  const [tenant, setTenant] = useState<TenantPublic | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [slug, setSlug] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return

    const hostname = window.location.hostname
    const extracted = extractSubdomain(hostname)
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
  }, [])

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
