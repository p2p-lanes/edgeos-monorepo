"use client"

import { Loader } from "@/components/ui/Loader"
import useHumanAttendeesQuery from "@/hooks/useHumanAttendeesQuery"
import { useCityProvider } from "@/providers/cityProvider"
import { AccessContent } from "./AccessContent"
import { projectScannableAccess } from "./accessProjection"

export default function TicketsAccessPage() {
  const { getCity } = useCityProvider()
  const city = getCity()
  const attendees = useHumanAttendeesQuery(city ? String(city.id) : null)

  if (!city || attendees.isLoading) return <Loader />

  return <AccessContent access={projectScannableAccess(attendees.data ?? [])} />
}
