"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { Loader } from "@/components/ui/Loader"
import { useCityProvider } from "@/providers/cityProvider"
import NoPopupsWelcome from "./NoPopupsWelcome"

const Page = () => {
  const { getCity, getPopups, popupsLoaded } = useCityProvider()
  const router = useRouter()

  useEffect(() => {
    const city = getCity()
    if (popupsLoaded && city) {
      router.push(`/portal/${city.slug}`)
    }
  }, [popupsLoaded, getCity, router])

  // Portal popups are pre-filtered by status and visible_in_portal.
  const hasVisiblePopups = getPopups().length > 0

  if (popupsLoaded && !hasVisiblePopups) {
    return <NoPopupsWelcome />
  }

  return (
    <div className="w-full h-full">
      <Loader />
    </div>
  )
}
export default Page
