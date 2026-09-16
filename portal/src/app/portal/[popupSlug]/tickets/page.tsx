"use client"

import { useParams } from "next/navigation"
import { LegacyTicketsRedirect } from "./LegacyTicketsRedirect"

export default function LegacyTicketsPage() {
  const params = useParams<{ popupSlug: string }>()

  return <LegacyTicketsRedirect popupSlug={params.popupSlug} />
}
