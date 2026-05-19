"use client"

import { Check, Copy } from "lucide-react"
import { useState } from "react"

interface CopyAgentBriefProps {
  apiBase: string
}

export function CopyAgentBrief({ apiBase }: CopyAgentBriefProps) {
  const [copied, setCopied] = useState(false)

  const snippet = `You are integrating with the EdgeOS Events API — a portal-scoped HTTP API for reading events, RSVPing, managing invitations, and managing venues on behalf of an authenticated user.

API root:        ${apiBase}
Endpoint prefix: /api/v1  (prepend this to every path from the OpenAPI spec — the bare prefix is not a fetchable endpoint, only paths beneath it resolve)
OpenAPI spec:    ${apiBase}/openapi.json

Authentication
  Send \`Authorization: Bearer <token>\` on every request.
  Tokens are personal access tokens that the user issues at /portal/api-keys.
  Scopes: events:read, events:write, rsvp:write, venues:write.
  Write scopes (events:write, venues:write) require an expiry and rotate periodically.

Conventions
  - List endpoints return { results: T[], paging }; single-resource endpoints return the resource directly.
  - All timestamps are ISO-8601 with timezone; IDs are RFC-4122 UUIDs.
  - Recurring events expand into virtual occurrences when \`start_after\` is set on list queries.
    To act on a single occurrence (e.g. RSVP), pass that occurrence's \`start_time\` as \`occurrence_start\`.
  - Errors: 401 bad/expired token, 403 missing scope, 404 hidden/not found, 409 dependency conflict, 422 validation, 429 rate-limited (see Retry-After).

First step: fetch the OpenAPI spec above and treat it as the source of truth for every endpoint, parameter, and response schema before making any calls. Each path in the spec already starts with /api/v1 — do not double the prefix.`

  const onCopy = async () => {
    await navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
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
