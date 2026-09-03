import type { AttendeeWithOriginPublic } from "@/client"

export interface PortalPerson {
  id: string
  name: string
  relationship: "primary" | "dependent"
  canManage: true
}

export function projectPeople(
  attendees: AttendeeWithOriginPublic[],
): PortalPerson[] {
  return attendees.map((attendee) => ({
    id: attendee.id,
    name: attendee.name,
    relationship: attendee.category === "main" ? "primary" : "dependent",
    canManage: true,
  }))
}
