import {
  CalendarDays,
  FileText,
  Layers,
  MapPin,
  Ticket,
  Users,
} from "lucide-react"
import type { PopupPublic } from "@/client"
import { OpenClaw } from "@/components/Icons/OpenClaw"
import type { Resource } from "@/types/resources"

type Translator = (key: string, opts?: Record<string, unknown>) => string

/**
 * Sidebar resources for an ended (recap) popup. Application and Passes are shown
 * but locked (`disabled`); Events and the attendee directory are open to anyone
 * who participated, honoring the popup's events/directory feature flags.
 */
export function buildEndedResources({
  t,
  city,
  participated,
}: {
  t: Translator
  city: PopupPublic
  participated: boolean
}): Resource[] {
  const eventsEnabled = city?.events_enabled ?? true
  const directoryEnabled =
    city?.sale_type !== "direct" && (city?.show_attendee_directory ?? false)
  const eventsVisible = participated && eventsEnabled
  const directoryVisible = participated && directoryEnabled
  const eventsStatus = eventsVisible ? "active" : "hidden"

  return [
    {
      name: t("sidebar.recap", { defaultValue: "Recap" }),
      icon: FileText,
      status: "active",
      path: `/portal/${city?.slug}`,
    },
    {
      name: t("sidebar.application"),
      icon: FileText,
      status: "disabled",
      path: `/portal/${city?.slug}/application`,
    },
    {
      name: t("sidebar.passes"),
      icon: Ticket,
      status: "disabled",
      path: `/portal/${city?.slug}/passes`,
    },
    {
      name: t("sidebar.attendee_directory"),
      icon: Users,
      status: directoryVisible ? "active" : "hidden",
      path: `/portal/${city?.slug}/attendees`,
    },
    {
      name: t("sidebar.events"),
      icon: CalendarDays,
      status: eventsStatus,
      path: `/portal/${city?.slug}/events`,
      children: [
        {
          name: t("sidebar.tracks", { defaultValue: "Tracks" }),
          icon: Layers,
          status: eventsStatus,
          path: `/portal/${city?.slug}/events/tracks`,
        },
        {
          name: t("sidebar.venues"),
          icon: MapPin,
          status: eventsStatus,
          path: `/portal/${city?.slug}/events/venues`,
        },
        {
          name: t("sidebar.agentic_access", { defaultValue: "Agentic access" }),
          icon: OpenClaw,
          status: eventsStatus,
          path: "/portal/agentic-access",
        },
      ],
    },
  ]
}
