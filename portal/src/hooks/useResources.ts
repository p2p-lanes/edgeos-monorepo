import {
  CalendarDays,
  FileText,
  Layers,
  Link2,
  MapPin,
  ShoppingBag,
  Ticket,
  Users,
} from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useTranslation } from "react-i18next"
import { OpenClaw } from "@/components/Icons/OpenClaw"
import { buildEndedResources } from "@/hooks/endedResources"
import useAuth from "@/hooks/useAuth"
import { useGatheringDoors } from "@/hooks/useGatheringDoors"
import { useHumanPopupAccess } from "@/hooks/useHumanPopupAccess"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"
import type { Resource } from "@/types/resources"

const useResources = () => {
  const { t } = useTranslation()
  const { getCity } = useCityProvider()
  const { getRelevantApplication, participation } = useApplication()
  // Which door into the gathering the sidebar is describing. It is
  // always on screen, so with two applications and no door named it
  // would have to speak for both at once — one status, one passes link
  // (sdd/sales-flows-rediseno). Absent means a single application,
  // which is almost everyone.
  const flowId = useSearchParams().get("flow")
  // Every link keeps the door, so moving through the sidebar never
  // drops back to guessing.
  const flowQuery = flowId ? `?flow=${flowId}` : ""
  const { user } = useAuth()
  const application = getRelevantApplication(flowId)
  const city = getCity()
  const { doors } = useGatheringDoors(city?.id ? String(city.id) : null)
  // Named only when there is more than one way in. With a single door the
  // sidebar has nothing to disambiguate and saying its name would be noise.
  const doorName =
    doors.length > 1
      ? (doors.find((door) => door.flowId === flowId)?.name ?? null)
      : null
  const endedAccess = useHumanPopupAccess(
    city?.status === "ended" && city?.id ? String(city.id) : null,
  )

  // What the sidebar actually branches on: whether anybody applies here. A
  // gathering can take applications through one door and sell through
  // another, so the popup's `sale_type` can no longer answer it.
  const nobodyApplies = city?.takes_applications === false

  if (city?.status === "ended" && !nobodyApplies) {
    const resources = buildEndedResources({
      t,
      city,
      participated: endedAccess.state === "allowed",
    })
    return { resources, doorName: null }
  }

  // Popup-level feature flag: hides the entire events module when off.
  // Whether humans can *create* events is a separate setting handled
  // inside the events page itself (event_settings.event_enabled).
  const eventsEnabled = city?.events_enabled ?? true
  const attendeeDirectoryEnabled =
    !nobodyApplies && (city?.show_attendee_directory ?? false)
  const referralsEnabled = city?.referrals_enabled === true

  const isCompanion = participation?.type === "companion"
  const canSeeAttendees = application?.status === "accepted"
  const companionCanSeePasses = isCompanion
  const companionApplicationAccepted =
    participation?.type === "companion" &&
    participation?.application_status === "accepted"

  // Where nobody applies there is no application and no reviewer-controlled
  // attendee list, just an event overview that links to checkout plus a
  // passes view for managing existing purchases. The events module
  // (and its API Keys/Docs subsections) is not exposed in this flow.
  if (nobodyApplies && user) {
    const resources: Resource[] = [
      {
        name: t("sidebar.overview", { defaultValue: "Overview" }),
        icon: Ticket,
        status: "active",
        path: `/portal/${city?.slug}${flowQuery}`,
      },
      {
        name: t("sidebar.passes"),
        icon: Ticket,
        status: "active",
        path: `/portal/${city?.slug}/passes${flowQuery}`,
      },
      {
        name: t("sidebar.shop"),
        icon: ShoppingBag,
        status: "active",
        path: `/portal/${city?.slug}/shop`,
      },
    ]

    return { resources, doorName: null }
  }

  if (isCompanion) {
    const companionEventsVisible = companionApplicationAccepted && eventsEnabled
    const resources: Resource[] = [
      {
        name: t("sidebar.companion"),
        icon: Users,
        status: "active",
        path: `/portal/${city?.slug}${flowQuery}`,
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
        path: `/portal/${city?.slug}/passes${flowQuery}`,
      },
      {
        name: t("sidebar.shop"),
        icon: ShoppingBag,
        status: "active",
        path: `/portal/${city?.slug}/shop`,
      },
      {
        name: t("sidebar.events"),
        icon: CalendarDays,
        status: companionEventsVisible ? "active" : "hidden",
        path: `/portal/${city?.slug}/events${flowQuery}`,
        children: [
          {
            name: t("sidebar.tracks", { defaultValue: "Tracks" }),
            icon: Layers,
            status: companionEventsVisible ? "active" : "hidden",
            path: `/portal/${city?.slug}/events/tracks${flowQuery}`,
          },
          {
            name: t("sidebar.venues"),
            icon: MapPin,
            status: companionEventsVisible ? "active" : "hidden",
            path: `/portal/${city?.slug}/events/venues${flowQuery}`,
          },
          {
            name: t("sidebar.agentic_access", {
              defaultValue: "Agentic access",
            }),
            icon: OpenClaw,
            status: companionEventsVisible ? "active" : "hidden",
            path: "/portal/agentic-access",
          },
        ],
      },
    ]

    return { resources, doorName: null }
  }

  const resources: Resource[] = [
    {
      name: t("sidebar.application"),
      icon: FileText,
      status: "active",
      path: `/portal/${city?.slug}${flowQuery}`,
      // The status is omitted rather than guessed when several doors are
      // open and none is named: "not started" alongside two accepted
      // applications is not an incomplete answer, it is a wrong one
      // (sdd/sales-flows-rediseno).
      children:
        !application && doors.length > 1
          ? []
          : [
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
      path: `/portal/${city?.slug}/passes${flowQuery}`,
    },
    {
      name: t("sidebar.shop"),
      icon: ShoppingBag,
      status: "active",
      path: `/portal/${city?.slug}/shop`,
    },
    {
      name: t("sidebar.attendee_directory"),
      icon: Users,
      status: canSeeAttendees && attendeeDirectoryEnabled ? "active" : "hidden",
      path: `/portal/${city?.slug}/attendees${flowQuery}`,
    },
    {
      name: t("sidebar.events"),
      icon: CalendarDays,
      status: canSeeAttendees && eventsEnabled ? "active" : "hidden",
      path: `/portal/${city?.slug}/events${flowQuery}`,
      children: [
        {
          name: t("sidebar.tracks", { defaultValue: "Tracks" }),
          icon: Layers,
          status: canSeeAttendees && eventsEnabled ? "active" : "hidden",
          path: `/portal/${city?.slug}/events/tracks${flowQuery}`,
        },
        {
          name: t("sidebar.venues"),
          icon: MapPin,
          status: canSeeAttendees && eventsEnabled ? "active" : "hidden",
          path: `/portal/${city?.slug}/events/venues${flowQuery}`,
        },
        {
          name: t("sidebar.agentic_access", { defaultValue: "Agentic access" }),
          icon: OpenClaw,
          status: canSeeAttendees && eventsEnabled ? "active" : "hidden",
          path: "/portal/agentic-access",
        },
      ],
    },
    {
      name: t("sidebar.referrals"),
      icon: Link2,
      status: canSeeAttendees && referralsEnabled ? "active" : "hidden",
      path: `/portal/${city?.slug}/referrals${flowQuery}`,
    },
  ]

  return { resources, doorName }
}
export default useResources
