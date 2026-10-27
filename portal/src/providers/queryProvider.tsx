"use client"

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { ApiError } from "@/client"
import { getAuthRedirectPath } from "@/lib/safe-return-to"

/**
 * A stale session drops the token and sends the person to log in. Queries
 * that only enrich a public page (meta `optionalAuth`) just drop the token,
 * so an anonymous visitor keeps reading the page.
 */
function handleApiError(error: Error, optionalAuth = false) {
  if (error instanceof ApiError && error.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("token")
      if (optionalAuth) return
      const { pathname, search, hash } = window.location
      const isPublicRoute =
        pathname.startsWith("/checkout") ||
        pathname.startsWith("/groups/") ||
        pathname.startsWith("/r/") ||
        pathname.includes("/invite/")
      const isAuthRoute = pathname === "/auth" || pathname.startsWith("/auth/")
      if (!isPublicRoute && !isAuthRoute) {
        window.location.replace(
          getAuthRedirectPath(`${pathname}${search}${hash}`),
        )
      }
    }
  }
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status === 401) return false
          return failureCount < 3
        },
      },
    },
    queryCache: new QueryCache({
      onError: (error, query) =>
        handleApiError(error, query.meta?.optionalAuth === true),
    }),
    mutationCache: new MutationCache({
      onError: (error) => handleApiError(error),
    }),
  })
}

export default function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient)

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}
