import { FileText, Ticket, Users } from "lucide-react"
import { useTranslation } from "react-i18next"
import useAuth from "@/hooks/useAuth"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"
import type { Resource } from "@/types/resources"

const useResources = () => {
  const { t } = useTranslation()
  const { getCity } = useCityProvider()
  const { getRelevantApplication, participation } = useApplication()
  const { user } = useAuth()
  const application = getRelevantApplication()
  const city = getCity()

  const isCompanion = participation?.type === "companion"
  const canSeeAttendees = application?.status === "accepted"
  const companionCanSeePasses = isCompanion

  // Direct-sale popups have no application and no reviewer-controlled
  // attendees — just checkout + passes browsing once logged in.
  if (city?.sale_type === "direct" && user) {
    const resources: Resource[] = [
      {
        name: t("sidebar.checkout", { defaultValue: "Checkout" }),
        icon: Ticket,
        status: "active",
        path: `/portal/${city?.slug}`,
      },
      {
        name: t("sidebar.passes"),
        icon: Ticket,
        status: "active",
        path: `/portal/${city?.slug}/passes`,
      },
    ]

    return { resources }
  }

  if (isCompanion) {
    const resources: Resource[] = [
      {
        name: t("sidebar.companion"),
        icon: Users,
        status: "active",
        path: `/portal/${city?.slug}`,
        children: [
          {
            name: t("sidebar.status"),
            status: "inactive",
            value: "companion",
          },
        ],
      },
      {
        name: t("sidebar.passes"),
        icon: Ticket,
        status: companionCanSeePasses ? "active" : "hidden",
        path: `/portal/${city?.slug}/passes`,
      },
    ]

    return { resources }
  }

  const resources: Resource[] = [
    {
      name: t("sidebar.application"),
      icon: FileText,
      status: "active",
      path: `/portal/${city?.slug}`,
      children: [
        {
          name: t("sidebar.status"),
          status: "inactive",
          value: application?.status ?? "not started",
        },
      ],
    },
    {
      name: t("sidebar.passes"),
      icon: Ticket,
      status: canSeeAttendees ? "active" : "hidden",
      path: `/portal/${city?.slug}/passes`,
    },
    {
      name: t("sidebar.attendee_directory"),
      icon: Users,
      status: canSeeAttendees ? "active" : "hidden",
      path: `/portal/${city?.slug}/attendees`,
    },
  ]

  return { resources }
}
export default useResources
