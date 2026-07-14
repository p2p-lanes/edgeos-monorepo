"use client"
import { useParams, useRouter } from "next/navigation"
import { type ReactNode, useEffect } from "react"
import { Loader } from "@/components/ui/Loader"
import { useCityProvider } from "@/providers/cityProvider"
import { GroupsProvider } from "@/providers/groupsProvider"

const Layout = ({ children }: { children: ReactNode }) => {
  const params = useParams()
  const router = useRouter()
  const { getCity } = useCityProvider()
  const city = getCity()
  const isEnded = city?.status === "ended"

  // Ended popups are read-only: no pass purchase or management. Guarding here
  // rather than per-page covers /passes and every nested route (e.g. /buy).
  useEffect(() => {
    if (isEnded) {
      router.replace(`/portal/${params.popupSlug}`)
    }
  }, [isEnded, params.popupSlug, router])

  if (isEnded) {
    return <Loader />
  }

  return (
    <GroupsProvider>
      <div className="py-6">{children}</div>
    </GroupsProvider>
  )
}
export default Layout
