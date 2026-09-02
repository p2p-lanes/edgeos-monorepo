"use client"

import { Loader } from "@/components/ui/Loader"
import useHumanAttendeesQuery from "@/hooks/useHumanAttendeesQuery"
import { useCityProvider } from "@/providers/cityProvider"
import { PeopleContent } from "./PeopleContent"
import { projectPeople } from "./peopleProjection"

export default function PeoplePage() {
  const { getCity } = useCityProvider()
  const city = getCity()
  const attendees = useHumanAttendeesQuery(city ? String(city.id) : null)

  if (!city || attendees.isLoading) return <Loader />

  return <PeopleContent people={projectPeople(attendees.data ?? [])} />
}
