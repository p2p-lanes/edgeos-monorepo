"use client"

import { Loader } from "@/components/ui/Loader"
import useHumanAttendeesQuery from "@/hooks/useHumanAttendeesQuery"
import useHumanPaymentsQuery from "@/hooks/useHumanPaymentsQuery"
import { useCityProvider } from "@/providers/cityProvider"
import { AccessContent } from "./AccessContent"
import { projectTicketAccess } from "./accessProjection"

export default function TicketsAccessPage() {
  const { getCity } = useCityProvider()
  const city = getCity()
  const attendees = useHumanAttendeesQuery(city ? String(city.id) : null)
  const payments = useHumanPaymentsQuery(city ? String(city.id) : null)

  if (!city || attendees.isLoading || payments.isLoading) return <Loader />

  return (
    <AccessContent
      access={projectTicketAccess(attendees.data ?? [], payments.data ?? [])}
    />
  )
}
