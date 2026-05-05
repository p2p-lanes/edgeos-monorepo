import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Events API",
  description:
    "Read events and RSVP on a user's behalf with a portal personal access token.",
}

type Method = "GET" | "POST"
type Scope = "events:read" | "rsvp:write"

interface EndpointProps {
  method: Method
  path: string
  scope: Scope
  summary: string
  params?: { name: string; type: string; note?: string }[]
  body?: { name: string; type: string; note?: string }[]
}

const methodColor: Record<Method, string> = {
  GET: "bg-emerald-100 text-emerald-700",
  POST: "bg-sky-100 text-sky-700",
}

function Endpoint({
  method,
  path,
  scope,
  summary,
  params,
  body,
}: EndpointProps) {
  return (
    <div className="border rounded-lg overflow-hidden bg-card">
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/40">
        <span
          className={`text-xs font-mono font-semibold px-2 py-0.5 rounded ${methodColor[method]}`}
        >
          {method}
        </span>
        <code className="text-sm font-mono flex-1 truncate">{path}</code>
        <span className="text-xs font-mono text-muted-foreground shrink-0">
          {scope}
        </span>
      </div>
      <div className="px-4 py-3 space-y-3">
        <p className="text-sm text-muted-foreground">{summary}</p>
        {params && params.length > 0 && <FieldList title="Query" items={params} />}
        {body && body.length > 0 && <FieldList title="Body" items={body} />}
      </div>
    </div>
  )
}

function FieldList({
  title,
  items,
}: {
  title: string
  items: { name: string; type: string; note?: string }[]
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
        {title}
      </h4>
      <ul className="text-sm space-y-1">
        {items.map((p) => (
          <li key={p.name} className="font-mono text-xs">
            <span className="text-foreground font-semibold">{p.name}</span>
            <span className="text-muted-foreground"> · {p.type}</span>
            {p.note && <span className="text-muted-foreground"> — {p.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Section({
  title,
  id,
  children,
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

const ERRORS: { code: string; meaning: string }[] = [
  { code: "401", meaning: "Missing, malformed, revoked, or expired key." },
  { code: "403", meaning: "Key lacks the required scope for this route." },
  { code: "404", meaning: "Resource is hidden from the caller or doesn't exist." },
  { code: "422", meaning: "Body or query failed validation." },
  { code: "429", meaning: "Rate limit exceeded — see Retry-After header." },
]

export default function ApiDocsPage() {
  return (
    <div className="flex-1 p-6 bg-background">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">Events API</h1>
          <p className="text-muted-foreground">
            Read events and RSVP on a user's behalf using a portal-issued
            personal access token.
          </p>
        </header>

        <Section title="Quick start">
          <div className="rounded-lg border bg-card divide-y text-sm">
            <Row label="Base path">
              <code className="font-mono text-xs">/api/v1</code>
              <span className="text-muted-foreground">
                {" "}
                on the host the user signs in to
              </span>
            </Row>
            <Row label="Auth header">
              <code className="font-mono text-xs">
                Authorization: Bearer eos_live_…
              </code>
            </Row>
            <Row label="Get a token">
              <Link
                href="/portal/api-keys"
                className="underline underline-offset-2"
              >
                /portal/api-keys
              </Link>
            </Row>
            <Row label="Scopes available">
              <code className="font-mono text-xs">events:read</code>
              <span className="text-muted-foreground">, </span>
              <code className="font-mono text-xs">rsvp:write</code>
            </Row>
            <Row label="OpenAPI spec">
              <code className="font-mono text-xs">/api/v1/openapi.json</code>
              <span className="text-muted-foreground">
                {" "}
                — feed this directly to an agent
              </span>
            </Row>
          </div>
        </Section>

        <Section title="Conventions">
          <ul className="text-sm space-y-1 text-muted-foreground list-disc pl-5">
            <li>
              List endpoints return{" "}
              <code className="font-mono text-xs">
                {"{ results: T[], paging }"}
              </code>
              ; single-resource endpoints return the resource directly.
            </li>
            <li>Times are ISO-8601 with timezone. UUIDs are RFC-4122.</li>
            <li>
              Recurring events expand into virtual occurrences when{" "}
              <code className="font-mono text-xs">start_after</code> is set.
              Pass the occurrence's{" "}
              <code className="font-mono text-xs">start_time</code> as{" "}
              <code className="font-mono text-xs">occurrence_start</code> when
              RSVPing to a single instance.
            </li>
          </ul>
        </Section>

        <Section title="Errors">
          <div className="rounded-lg border bg-card divide-y">
            {ERRORS.map((e) => (
              <div
                key={e.code}
                className="flex items-baseline gap-3 px-4 py-2 text-sm"
              >
                <code className="font-mono text-xs w-10 shrink-0">
                  {e.code}
                </code>
                <span className="text-muted-foreground">{e.meaning}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Events" id="events">
          <Endpoint
            method="GET"
            path="/api/v1/events/portal/events"
            scope="events:read"
            summary="List events visible to the caller."
            params={[
              { name: "popup_id", type: "uuid", note: "scope to one popup" },
              { name: "kind", type: "string" },
              { name: "venue_id", type: "uuid" },
              { name: "track_id", type: "uuid" },
              { name: "tags", type: "string[]" },
              {
                name: "start_after",
                type: "ISO datetime",
                note: "expands recurring masters into occurrences",
              },
              { name: "start_before", type: "ISO datetime" },
              { name: "search", type: "string", note: "fuzzy title match" },
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
            scope="events:read"
            summary="Fetch one event. Includes the caller's RSVP status."
            params={[
              {
                name: "occurrence_start",
                type: "ISO datetime",
                note: "scope RSVP lookup to one instance of a recurring event",
              },
            ]}
          />
        </Section>

        <Section title="RSVP" id="rsvp">
          <Endpoint
            method="POST"
            path="/api/v1/event-participants/portal/register/{event_id}"
            scope="rsvp:write"
            summary="RSVP to an event."
            body={[
              {
                name: "occurrence_start",
                type: "ISO datetime",
                note: "required for recurring events, omit for one-offs",
              },
            ]}
          />

          <Endpoint
            method="POST"
            path="/api/v1/event-participants/portal/cancel-registration/{event_id}"
            scope="rsvp:write"
            summary="Cancel a previous RSVP."
          />

          <Endpoint
            method="GET"
            path="/api/v1/event-participants/portal/participants"
            scope="events:read"
            summary="List the caller's own RSVPs across events."
          />
        </Section>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-4 px-4 py-2">
      <span className="text-xs font-semibold uppercase text-muted-foreground w-32 shrink-0">
        {label}
      </span>
      <span className="text-sm">{children}</span>
    </div>
  )
}
