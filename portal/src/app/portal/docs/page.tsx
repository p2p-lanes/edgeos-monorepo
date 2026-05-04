import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "API Documentation",
  description:
    "Reference for the EdgeOS Events API: authentication, endpoints, and parameters.",
}

interface EndpointProps {
  method: "GET" | "POST" | "PATCH" | "DELETE"
  path: string
  summary: string
  params?: { name: string; type: string; note?: string }[]
  body?: { name: string; type: string; note?: string }[]
}

const methodColor: Record<EndpointProps["method"], string> = {
  GET: "bg-emerald-100 text-emerald-700",
  POST: "bg-sky-100 text-sky-700",
  PATCH: "bg-amber-100 text-amber-700",
  DELETE: "bg-rose-100 text-rose-700",
}

function Endpoint({ method, path, summary, params, body }: EndpointProps) {
  return (
    <div className="border rounded-lg overflow-hidden bg-card">
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/40">
        <span
          className={`text-xs font-mono font-semibold px-2 py-0.5 rounded ${methodColor[method]}`}
        >
          {method}
        </span>
        <code className="text-sm font-mono">{path}</code>
      </div>
      <div className="px-4 py-3 space-y-3">
        <p className="text-sm text-muted-foreground">{summary}</p>
        {params && params.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
              Query parameters
            </h4>
            <ul className="text-sm space-y-1">
              {params.map((p) => (
                <li key={p.name} className="font-mono text-xs">
                  <span className="text-foreground font-semibold">
                    {p.name}
                  </span>
                  <span className="text-muted-foreground"> · {p.type}</span>
                  {p.note && (
                    <span className="text-muted-foreground"> — {p.note}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {body && body.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
              Body fields
            </h4>
            <ul className="text-sm space-y-1">
              {body.map((p) => (
                <li key={p.name} className="font-mono text-xs">
                  <span className="text-foreground font-semibold">
                    {p.name}
                  </span>
                  <span className="text-muted-foreground"> · {p.type}</span>
                  {p.note && (
                    <span className="text-muted-foreground"> — {p.note}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

function Section({
  title,
  children,
  id,
}: {
  title: string
  id?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="space-y-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export default function ApiDocsPage() {
  return (
    <div className="flex-1 p-6 bg-background">
      <div className="max-w-4xl mx-auto space-y-10">
        <header className="space-y-3">
          <h1 className="text-3xl font-semibold">Events API</h1>
          <p className="text-muted-foreground">
            REST API for reading and writing community events. Designed to be
            consumed by scripts or AI agents acting on behalf of an end user.
          </p>
        </header>

        <Section title="Base URL">
          <p className="text-sm">
            All endpoints are served under{" "}
            <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
              /api/v1
            </code>{" "}
            on the same host that serves this portal. Production hosts may
            differ per tenant — use the host the user signed in to.
          </p>
        </Section>

        <Section title="Authentication" id="auth">
          <p className="text-sm">
            Every request must include a personal API key in the{" "}
            <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
              Authorization
            </code>{" "}
            header:
          </p>
          <pre className="text-xs font-mono bg-muted px-3 py-2 rounded">
            Authorization: Bearer eos_live_…
          </pre>
          <p className="text-sm">
            Keys inherit the permissions of the user who created them. They
            never expire automatically unless an expiry is set at creation, and
            they can be revoked at any time. Get one from the{" "}
            <Link
              href="/portal/api-keys"
              className="underline underline-offset-2"
            >
              API keys page
            </Link>{" "}
            in the portal.
          </p>
        </Section>

        <Section title="Errors">
          <ul className="text-sm space-y-1 list-disc pl-5 text-muted-foreground">
            <li>
              <code className="font-mono text-xs">401</code> — missing,
              malformed, revoked or expired key.
            </li>
            <li>
              <code className="font-mono text-xs">403</code> — key is valid but
              the action exceeds the owner's permissions.
            </li>
            <li>
              <code className="font-mono text-xs">404</code> — resource doesn't
              exist or isn't visible to the caller.
            </li>
            <li>
              <code className="font-mono text-xs">409</code> — conflict (e.g.
              venue already booked for the requested window).
            </li>
            <li>
              <code className="font-mono text-xs">422</code> — request body or
              query failed validation.
            </li>
          </ul>
        </Section>

        <Section title="Events" id="events">
          <p className="text-sm text-muted-foreground">
            Endpoints scoped to events visible to the caller. Visibility rules:
            public events are visible to everyone in the tenant, private events
            only to the owner and explicit invitees, unlisted events only via
            direct ID lookup.
          </p>

          <Endpoint
            method="GET"
            path="/api/v1/events/portal/events"
            summary="List events visible to the caller, with filters."
            params={[
              { name: "popup_id", type: "uuid", note: "scope to one popup" },
              {
                name: "kind",
                type: "string",
                note: "free-form category, e.g. 'futbol'",
              },
              { name: "venue_id", type: "uuid" },
              { name: "track_id", type: "uuid" },
              { name: "tags", type: "string[]" },
              {
                name: "start_after",
                type: "ISO datetime",
                note: "events starting at or after this instant",
              },
              {
                name: "start_before",
                type: "ISO datetime",
                note: "events starting strictly before this instant",
              },
              {
                name: "search",
                type: "string",
                note: "fuzzy match on title",
              },
              {
                name: "rsvped_only",
                type: "boolean",
                note: "only events the caller has RSVPed to",
              },
              { name: "skip", type: "int" },
              { name: "limit", type: "int", note: "max 100" },
            ]}
          />

          <Endpoint
            method="GET"
            path="/api/v1/events/portal/events/{event_id}"
            summary="Fetch a single event by ID. Includes the caller's RSVP status."
            params={[
              {
                name: "occurrence_start",
                type: "ISO datetime",
                note: "for recurring events, scope RSVP lookup to one instance",
              },
            ]}
          />

          <Endpoint
            method="POST"
            path="/api/v1/events/portal/events"
            summary="Create a new event owned by the caller. May be auto-flagged for admin approval depending on venue policy."
            body={[
              { name: "popup_id", type: "uuid", note: "required" },
              { name: "title", type: "string", note: "required, ≤255 chars" },
              { name: "start_time", type: "ISO datetime", note: "required" },
              { name: "end_time", type: "ISO datetime", note: "required" },
              { name: "timezone", type: "string", note: "IANA, default UTC" },
              { name: "content", type: "string" },
              { name: "kind", type: "string" },
              { name: "tags", type: "string[]" },
              { name: "venue_id", type: "uuid" },
              { name: "track_id", type: "uuid" },
              {
                name: "visibility",
                type: "'public'|'private'|'unlisted'",
              },
              { name: "max_participant", type: "int" },
              { name: "cover_url", type: "string" },
              { name: "meeting_url", type: "string" },
              {
                name: "recurrence",
                type: "RecurrenceRule",
                note: "{freq, interval, by_day?, count?, until?}",
              },
            ]}
          />

          <Endpoint
            method="PATCH"
            path="/api/v1/events/portal/events/{event_id}"
            summary="Update fields on an event the caller owns. Same body shape as create; all fields optional."
          />

          <Endpoint
            method="POST"
            path="/api/v1/events/portal/events/{event_id}/hide"
            summary="Hide an event from the caller's portal listings. Idempotent."
          />

          <Endpoint
            method="DELETE"
            path="/api/v1/events/portal/events/{event_id}/hide"
            summary="Undo a previous hide."
          />
        </Section>

        <Section title="RSVP" id="rsvp">
          <Endpoint
            method="POST"
            path="/api/v1/event-participants/portal/register/{event_id}"
            summary="RSVP to an event. For recurring series, pass occurrence_start to RSVP to a specific instance."
            body={[
              {
                name: "occurrence_start",
                type: "ISO datetime",
                note: "optional, only for recurring events",
              },
            ]}
          />

          <Endpoint
            method="POST"
            path="/api/v1/event-participants/portal/cancel-registration/{event_id}"
            summary="Cancel a previous RSVP."
          />

          <Endpoint
            method="GET"
            path="/api/v1/event-participants/portal/participants"
            summary="List the caller's own participations across events."
          />
        </Section>

        <Section title="Common response shapes">
          <p className="text-sm">
            List endpoints return{" "}
            <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
              {"{ results: T[], paging: { offset, limit, total } }"}
            </code>
            . Single-resource endpoints return the resource directly. Times are
            ISO-8601 with timezone. UUIDs are RFC-4122 strings.
          </p>
        </Section>

        <Section title="Schema reference">
          <p className="text-sm">
            The full machine-readable spec is served by the backend at{" "}
            <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
              /api/v1/openapi.json
            </code>
            . Hand it to your agent verbatim or import it into any OpenAPI
            tooling.
          </p>
        </Section>
      </div>
    </div>
  )
}
