"use client"

import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { Loader } from "@/components/ui/Loader"
import useAuth from "@/hooks/useAuth"
import { useApplicationsQuery } from "@/hooks/useGetApplications"
import { useHumanPopupAccess } from "@/hooks/useHumanPopupAccess"
import { useParticipationQuery } from "@/hooks/useParticipationQuery"
import useResources from "@/hooks/useResources"
import { useCityProvider } from "@/providers/cityProvider"

export default function PeopleLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { popupSlug } = useParams<{ popupSlug: string }>()
  const router = useRouter()
  const flowId = useSearchParams().get("flow")
  const { getCity } = useCityProvider()
  const city = getCity()
  const { user, isUserLoading } = useAuth()
  const applications = useApplicationsQuery()
  const participation = useParticipationQuery(city ? String(city.id) : null)
  const isEnded = city?.status === "ended"
  const endedAccess = useHumanPopupAccess(
    isEnded && city ? String(city.id) : null,
  )
  const { resources } = useResources()

  // Use the sidebar's actual policy, including companions and ended events,
  // rather than creating a second application/purchase eligibility rule.
  const peoplePath = `/portal/${popupSlug}/people`
  const visible = resources.some(
    (resource) =>
      resource.path?.split("?")[0] === peoplePath &&
      resource.status === "active",
  )
  const needsApplication = !isEnded && city?.takes_applications !== false
  const loading =
    !city ||
    isUserLoading ||
    (!!user &&
      (isEnded
        ? endedAccess.state === "loading"
        : needsApplication &&
          (applications.isLoading || participation.isLoading)))
  const failed =
    needsApplication && (applications.isError || participation.isError)
  const allowed = !!user && visible && !failed
  const home = `/portal/${popupSlug}${flowId ? `?${new URLSearchParams({ flow: flowId })}` : ""}`

  useEffect(() => {
    if (!loading && !allowed) router.replace(home)
  }, [loading, allowed, router, home])

  // Do not mount the page (or fetch its attendees) while resolving access or
  // redirecting. Direct URL visits must not flash restricted page content.
  if (loading || !allowed) return <Loader />

  return <>{children}</>
}
