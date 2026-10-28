"use client"

import { Check, Copy } from "lucide-react"
import { useState } from "react"
import type { ApiKeyScope } from "@/lib/apiKeysService"

interface AgentBriefPopup {
  id: string
  name: string
}

interface AgentBriefInput {
  apiBase: string
  // Scopes the token carries (or, before a key exists, the scopes the popup
  // offers). The brief only describes routes these scopes can reach, so an
  // agent never plans around calls that would come back 403.
  scopes: ApiKeyScope[]
  popup: AgentBriefPopup | null
}

const EVENT_ROUTES: { scope: ApiKeyScope; route: string }[] = [
  { scope: "events:read", route: "GET    /api/v1/events/portal/events" },
  {
    scope: "events:read",
    route: "GET    /api/v1/events/portal/events/{event_id}",
  },
  {
    scope: "events:read",
    route: "GET    /api/v1/events/portal/events/{event_id}/invitations",
  },
  {
    scope: "events:read",
    route: "GET    /api/v1/event-participants/portal/participants",
  },
  { scope: "events:read", route: "GET    /api/v1/event-venues/portal/venues" },
  { scope: "events:read", route: "GET    /api/v1/tracks/portal/tracks" },
  {
    scope: "events:read",
    route: "GET    /api/v1/event-settings/portal/settings/{popup_id}",
  },
  { scope: "events:write", route: "POST   /api/v1/events/portal/events" },
  {
    scope: "events:write",
    route: "PATCH  /api/v1/events/portal/events/{event_id}",
  },
  {
    scope: "events:write",
    route: "POST   /api/v1/events/portal/events/{event_id}/cancel",
  },
  {
    scope: "events:write",
    route: "DELETE /api/v1/events/portal/events/{event_id}",
  },
  {
    scope: "events:write",
    route: "POST   /api/v1/events/portal/events/{event_id}/invitations",
  },
  {
    scope: "events:write",
    route:
      "DELETE /api/v1/events/portal/events/{event_id}/invitations/{invitation_id}",
  },
  {
    scope: "rsvp:write",
    route: "POST   /api/v1/event-participants/portal/register/{event_id}",
  },
  {
    scope: "rsvp:write",
    route:
      "POST   /api/v1/event-participants/portal/cancel-registration/{event_id}",
  },
  { scope: "venues:write", route: "POST   /api/v1/event-venues/portal/venues" },
  {
    scope: "venues:write",
    route: "PATCH  /api/v1/event-venues/portal/venues/{venue_id}",
  },
  {
    scope: "venues:write",
    route: "DELETE /api/v1/event-venues/portal/venues/{venue_id}",
  },
]

export function buildAgentBrief({
  apiBase,
  scopes,
  popup,
}: AgentBriefInput): string {
  const hasDirectory = scopes.includes("directory:read")
  const eventRoutes = EVENT_ROUTES.filter((r) => scopes.includes(r.scope))
  const writeScopes = scopes.filter((scope) => scope.endsWith(":write"))
  const popupId = popup?.id ?? "{popup_id}"

  const capabilities = [
    eventRoutes.length > 0 && "work with the event calendar",
    hasDirectory && "read the attendee directory",
  ].filter(Boolean)

  const sections = [
    `You are integrating with the EdgeOS Portal API to ${capabilities.join(" and ") || "act"} on behalf of an authenticated user.

API root: ${apiBase}
Every path below already includes the /api/v1 prefix.

Authentication
  Send \`Authorization: Bearer <token>\` on every request.
  Scopes on this token: ${scopes.join(", ")}.
  ${
    popup
      ? `The token is bound to the popup "${popup.name}" (popup_id ${popup.id}); requests for any other popup return 403.`
      : "The token is bound to a single popup; requests for any other popup return 403."
  }${
    writeScopes.length > 0
      ? `\n  Write scopes (${writeScopes.join(", ")}) expire; ask the user for a new token when you get a 401.`
      : ""
  }
  The routes below are what this token is for; account, payment, application and admin endpoints return 403.`,
  ]

  if (hasDirectory) {
    sections.push(`Attendee directory (directory:read)
  GET /api/v1/applications/my/directory/${popupId}
    Query: q (matches shared names, emails and Telegram handles), hide_empty_rows (bool, skip entries with nothing shared), skip, limit (default 100, max 1000).
    Response: { results: Entry[], paging: { limit, offset, total } }. Page with skip until skip >= paging.total.
    Entry: id, first_name, last_name, email, telegram, role, organization, residence, age, gender, picture_url, category (main, spouse, kid, ...), fields (popup-specific [{ id, label, value }]), participation (products the attendee holds).
  Privacy: attendees choose what they share. A value of "*" means the attendee hid it; null means they never filled it in. Never try to infer hidden values, and treat everything here as personal data: don't publish or re-share it beyond what the user asked for.`)
  }

  if (eventRoutes.length > 0) {
    sections.push(`Event calendar
${eventRoutes.map((r) => `  ${r.route}  (${r.scope})`).join("\n")}
  Pass popup_id=${popupId} when listing events, venues or tracks.${
    scopes.includes("events:write")
      ? `
  New events need popup_id=${popupId}, either a venue_id or both custom_location_name and custom_location_url, and start/end times inside the popup's dates. Cancel keeps the event and notifies attendees; DELETE is permanent and owner-only.`
      : ""
  }
  Recurring events expand into virtual occurrences when \`start_after\` is set on list queries.
  To act on a single occurrence (e.g. RSVP), pass that occurrence's \`start_time\` as \`occurrence_start\`.`)
  }

  sections.push(`Conventions
  - List endpoints return { results: T[], paging }; single-resource endpoints return the resource directly.
  - All timestamps are ISO-8601 with timezone; IDs are RFC-4122 UUIDs.
  - Errors: 401 bad/expired token, 403 missing scope or other popup, 404 hidden/not found, 409 dependency conflict, 422 validation, 429 rate-limited (see Retry-After).
  - Request and response schemas: ${apiBase}/openapi.json (it documents the whole API; stick to the routes above).`)

  return sections.join("\n\n")
}

export function CopyAgentBrief(props: AgentBriefInput) {
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    await navigator.clipboard.writeText(buildAgentBrief(props))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 hover:bg-muted transition-colors"
    >
      {copied ? (
        <>
          <Check className="size-3.5" /> Copied
        </>
      ) : (
        <>
          <Copy className="size-3.5" /> Copy for agent
        </>
      )}
    </button>
  )
}
