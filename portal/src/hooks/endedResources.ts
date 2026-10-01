import {
  CalendarDays,
  FileText,
  Layers,
  Link2,
  MapPin,
  ReceiptText,
  Ticket,
  Users,
} from "lucide-react"
import type { PopupPublic } from "@/client"
import { OpenClaw } from "@/components/Icons/OpenClaw"
import type { Resource } from "@/types/resources"

type Translator = (key: string, opts?: Record<string, unknown>) => string

/**
 * Sidebar resources for an ended popup. Application points at the home card
 * (root) and stays active; authorized participants retain read-only attendee
 * passes and payment history. Events and the attendee directory honor the popup's
 * events/directory feature flags. Referrals stay reachable when the backend
 * says this attendee may share, because an ended popup is still a place to
 * send people on to the tenant's other events from.
 */
export function buildEndedResources({
  t,
  city,
  participated,
  canShareReferrals = false,
}: {
  t: Translator
  city: PopupPublic
  participated: boolean
  canShareReferrals?: boolean
}): Resource[] {
  const eventsEnabled = city?.events_enabled ?? true
  const directoryEnabled =
    city?.takes_applications !== false &&
    (city?.show_attendee_directory ?? false)
  const eventsVisible = participated && eventsEnabled
  const directoryVisible = participated && directoryEnabled
  const eventsStatus = eventsVisible ? "active" : "hidden"

  return [
    {
      name: t("sidebar.application"),
      icon: FileText,
      status: "active",
      path: `/portal/${city?.slug}`,
      group: "commerce",
    },
    {
      name: t("sidebar.passes"),
      icon: Ticket,
      status: participated ? "active" : "hidden",
      path: `/portal/${city?.slug}/passes`,
      group: "commerce",
    },
    {
      name: t("sidebar.orders"),
      icon: ReceiptText,
      status: "active",
      path: `/portal/${city?.slug}/orders`,
      group: "commerce",
    },
    {
      name: t("sidebar.attendee_directory"),
      icon: Users,
      status: directoryVisible ? "active" : "hidden",
      path: `/portal/${city?.slug}/attendees`,
      group: "community",
    },
    {
      name: t("sidebar.events"),
      icon: CalendarDays,
      status: eventsStatus,
      path: `/portal/${city?.slug}/events`,
      group: "community",
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
    {
      name: t("sidebar.referrals"),
      icon: Link2,
      status: canShareReferrals ? "active" : "hidden",
      path: `/portal/${city?.slug}/referrals`,
      group: "community",
    },
  ]
}
