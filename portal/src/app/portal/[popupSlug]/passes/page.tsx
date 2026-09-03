"use client"

import { useParams } from "next/navigation"
import { LegacyTicketsRedirect } from "../tickets/LegacyTicketsRedirect"

export default function LegacyPassesPage() {
  const params = useParams<{ popupSlug: string }>()

  return <LegacyTicketsRedirect popupSlug={params.popupSlug} />
}
