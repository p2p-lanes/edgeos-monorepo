import {
  BookOpen,
  CalendarDays,
  FileText,
  Key,
  MapPin,
  Ticket,
  Users,
} from "lucide-react"
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
  // Popup-level feature flag: hides the entire events module when off.
  // Whether humans can *create* events is a separate setting handled
  // inside the events page itself (event_settings.event_enabled).
  const eventsEnabled = city?.events_enabled ?? true

  const isCompanion = participation?.type === "companion"
  const canSeeAttendees = application?.status === "accepted"
  const companionCanSeePasses = isCompanion

  // Direct-sale popups have no application and no reviewer-controlled
  // attendees — just an event overview that links to checkout, plus a
  // passes view for managing existing purchases. The events module
  // (and its API Keys/Docs subsections) is not exposed in this flow.
  if (city?.sale_type === "direct" && user) {
    const resources: Resource[] = [
      {
        name: t("sidebar.overview", { defaultValue: "Overview" }),
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
    {
      name: t("sidebar.events"),
      icon: CalendarDays,
      status: canSeeAttendees && eventsEnabled ? "active" : "hidden",
      path: `/portal/${city?.slug}/events`,
      children: [
        {
          name: t("sidebar.venues"),
          icon: MapPin,
          status: canSeeAttendees && eventsEnabled ? "active" : "hidden",
          path: `/portal/${city?.slug}/events/venues`,
        },
        {
          name: t("sidebar.api_keys", { defaultValue: "API Keys" }),
          icon: Key,
          status: canSeeAttendees && eventsEnabled ? "active" : "hidden",
          path: "/portal/api-keys",
        },
        {
          name: t("sidebar.api_docs", { defaultValue: "API Docs" }),
          icon: BookOpen,
          status: canSeeAttendees && eventsEnabled ? "active" : "hidden",
          path: "/portal/docs",
        },
      ],
    },
  ]

  return { resources }
}
export default useResources
