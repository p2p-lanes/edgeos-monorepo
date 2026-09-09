import type { HumanSession } from "@/client"

export type PortalSession = HumanSession
export type SessionSnapshot = {
  status:
    | "unknown"
    | "authenticated"
    | "anonymous"
    | "unavailable"
    | "conflict"
    | "changing"
  session: PortalSession | null
}
export function hasVerifiedSession(snapshot: SessionSnapshot): boolean {
  return (
    snapshot.status === "authenticated" &&
    snapshot.session !== null &&
    Date.parse(snapshot.session.expires_at) > Date.now()
  )
}
export function sessionIdentity(session: PortalSession | null): string {
  return session
    ? `${session.human.tenant_id}:${session.human.id}`
    : "anonymous"
}
