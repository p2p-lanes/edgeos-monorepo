import type { EventPublic } from "@/client"

/**
 * Whether a human may manage an event (edit / cancel / invitations).
 *
 * Mirrors the backend's ``_human_manages_event``: the creator (owner), the
 * designated host, and any collaborator all carry the same rights over the
 * event. ``host_id`` is null when no directory human was assigned;
 * ``collaborator_ids`` is empty when none were added.
 */
export function canManageEvent(
  event: Pick<EventPublic, "owner_id" | "host_id" | "collaborator_ids">,
  humanId: string | null | undefined,
): boolean {
  if (humanId == null) return false
  if (event.owner_id === humanId || event.host_id === humanId) return true
  return event.collaborator_ids?.includes(humanId) ?? false
}
