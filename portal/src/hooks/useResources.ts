import { FileText, Ticket, Users } from "lucide-react"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"
import type { Resource } from "@/types/resources"

const useResources = () => {
  const { getCity } = useCityProvider()
  const { getRelevantApplication, participation } = useApplication()
  const application = getRelevantApplication()
  const city = getCity()

  const isCompanion = participation?.type === "companion"
  const canSeeAttendees = application?.status === "accepted"
  const companionCanSeePasses = isCompanion

  if (isCompanion) {
    const resources: Resource[] = [
      {
        name: "Companion",
        icon: Users,
        status: "active",
        path: `/portal/${city?.slug}`,
        children: [
          {
            name: "Status",
            status: "inactive",
            value: "companion",
          },
        ],
      },
      {
        name: "Passes",
        icon: Ticket,
        status: companionCanSeePasses ? "active" : "hidden",
        path: `/portal/${city?.slug}/passes`,
      },
    ]

    return { resources }
  }

  const resources: Resource[] = [
    {
      name: "Application",
      icon: FileText,
      status: "active",
      path: `/portal/${city?.slug}`,
      children: [
        {
          name: "Status",
          status: "inactive",
          value: application?.status ?? "not started",
        },
      ],
    },
    {
      name: "Passes",
      icon: Ticket,
      status: canSeeAttendees ? "active" : "hidden",
      path: `/portal/${city?.slug}/passes`,
    },
    {
      name: "Attendee Directory",
      icon: Users,
      status: canSeeAttendees ? "active" : "hidden",
      path: `/portal/${city?.slug}/attendees`,
    },
  ]

  return { resources }
}
export default useResources
