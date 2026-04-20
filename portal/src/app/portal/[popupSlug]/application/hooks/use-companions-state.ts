"use client"

import { useState } from "react"
import type { ApplicationPublic } from "@/client"
import type { CompanionWithId } from "../components/companions-section"

/** Seeds companions state from an existing application's attendees.
 *
 * The parent form remounts (via `key`) whenever the underlying application
 * changes, so a `useState` initializer is sufficient — we don't need to
 * react to prop changes. */
export function useCompanionsState(
  existingApplication?: ApplicationPublic | null,
) {
  return useState<CompanionWithId[]>(() => {
    if (!existingApplication?.attendees?.length) return []
    return existingApplication.attendees
      .filter((a) => a.category === "spouse" || a.category === "kid")
      .map((a) => ({
        _id: a.id,
        name: a.name,
        category: a.category,
        email: a.email ?? undefined,
        gender: a.gender ?? undefined,
      }))
  })
}
