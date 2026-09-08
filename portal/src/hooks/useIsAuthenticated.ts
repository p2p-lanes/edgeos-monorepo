"use client"

import { useSession } from "@/providers/sessionProvider"

export function useIsAuthenticated(): boolean {
  return useSession().snapshot.status === "authenticated"
}
