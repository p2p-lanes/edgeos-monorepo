import type { PopupPublic } from "@/client"

const startTime = (p: PopupPublic) => {
  if (!p.start_date) return Number.POSITIVE_INFINITY
  const t = new Date(p.start_date).getTime()
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
}

/**
 * Popups visible in the portal switcher: active (visible to everyone) plus
 * ended (recap mode — the backend already filtered these to popups the human
 * participated in). Active sorts before ended; within a group, by upcoming
 * start date then name.
 */
export function visiblePortalPopups(popups: PopupPublic[]): PopupPublic[] {
  const statusRank = (p: PopupPublic) => (p.status === "ended" ? 1 : 0)
  return popups
    .filter((p) => p.status === "active" || p.status === "ended")
    .sort((a, b) => {
      const rank = statusRank(a) - statusRank(b)
      if (rank !== 0) return rank
      const date = startTime(a) - startTime(b)
      if (date !== 0) return date
      return a.name.localeCompare(b.name)
    })
}
