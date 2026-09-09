"use client"

import { hasVerifiedSession } from "@/lib/session-contract"
import { useSession } from "@/providers/sessionProvider"

export function useIsAuthenticated(): boolean {
  return hasVerifiedSession(useSession().snapshot)
}
