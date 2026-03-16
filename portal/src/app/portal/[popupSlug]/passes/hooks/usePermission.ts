import { useParams, useRouter } from "next/navigation"
import { useEffect } from "react"
import { useApplication } from "@/providers/applicationProvider"

const usePermission = () => {
  const { getRelevantApplication, participation } = useApplication()
  const application = getRelevantApplication()
  const router = useRouter()
  const params = useParams()

  useEffect(() => {
    // Companions with tickets can access passes
    if (participation?.type === "companion") {
      return
    }

    if (application === null) return

    if (application && application.status !== "accepted") {
      router.replace(`/portal/${params.popupSlug}`)
      return
    }
  }, [application, participation, params.popupSlug, router.replace])
}
export default usePermission
