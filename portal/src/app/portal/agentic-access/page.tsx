"use client"

import { format } from "date-fns"
import { Check, Copy, Info, Key, Loader2, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import {
  EventsApiAccessUnavailable,
  useEventsApiAccess,
} from "@/components/EventsApiAccessGate"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useApiKeys } from "@/hooks/useApiKeys"
import type {
  ApiKeyCreated,
  ApiKeyPublic,
  ApiKeyScope,
} from "@/lib/apiKeysService"
import { CopyAgentBrief } from "./CopyAgentBrief"

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? ""

const DEFAULT_SCOPES: ApiKeyScope[] = ["events:read"]

const scopeKey = (scope: ApiKeyScope) => scope.replace(":", "_")

const SCOPE_OPTIONS: Array<{
  value: ApiKeyScope
  label: string
  description: string
}> = [
  {
    value: "events:read",
    label: "Read events",
    description:
      "List events and read the context needed for event automation.",
  },
  {
    value: "events:write",
    label: "Create events",
    description: "Create and edit events on your behalf.",
  },
  {
    value: "rsvp:write",
    label: "RSVP to events",
    description: "Register or cancel attendance for events.",
  },
  {
    value: "venues:write",
    label: "Manage own venues",
    description: "Create, edit, and delete venues you own.",
  },
]

type Method = "GET" | "POST" | "PATCH" | "DELETE"
type Scope = "events:read" | "events:write" | "rsvp:write" | "venues:write"

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
  PATCH: "bg-amber-100 text-amber-700",
  DELETE: "bg-rose-100 text-rose-700",
}

const ERRORS: { code: string; meaning: string }[] = [
  { code: "401", meaning: "Missing, malformed, revoked, or expired key." },
  { code: "403", meaning: "Key lacks the required scope for this route." },
  {
    code: "404",
    meaning: "Resource is hidden from the caller or doesn't exist.",
  },
  {
    code: "409",
    meaning:
      "Conflict — resource has dependent records (e.g. venue has events).",
  },
  { code: "422", meaning: "Body or query failed validation." },
  { code: "429", meaning: "Rate limit exceeded — see Retry-After header." },
]

export default function AgenticAccessPage() {
  const { allowed } = useEventsApiAccess()
  if (!allowed) return <EventsApiAccessUnavailable />

  return (
    <div className="flex-1 p-6 bg-background">
      <div className="max-w-4xl mx-auto space-y-10">
        <ApiKeysSection />
        <div className="border-t" />
        <ApiDocsSection />
      </div>
    </div>
  )
}

function ApiKeysSection() {
  const { t } = useTranslation()
  const {
    keys,
    isLoading,
    error,
    createKey,
    isCreating,
    revokeKey,
    isRevoking,
  } = useApiKeys()

  const [createOpen, setCreateOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState("")
  const [selectedScopes, setSelectedScopes] =
    useState<ApiKeyScope[]>(DEFAULT_SCOPES)
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null)
  const [copied, setCopied] = useState(false)
  const [pendingRevoke, setPendingRevoke] = useState<ApiKeyPublic | null>(null)

  const toggleScope = (scope: ApiKeyScope, checked: boolean) => {
    setSelectedScopes((current) => {
      if (scope === "events:read" && !checked) {
        return current
      }
      if (checked) {
        return current.includes(scope) ? current : [...current, scope]
      }
      return current.filter((item) => item !== scope)
    })
  }

  const onCreate = async () => {
    const name = newKeyName.trim()
    if (!name) return
    try {
      // The backend owns the write-scope lifetime: send ``expires_at: null``
      // and let it fill in the policy default. The created key returned in
      // the response already carries the final ``expires_at`` for display.
      const created = await createKey({
        name,
        scopes: selectedScopes,
        expires_at: null,
      })
      setCreatedKey(created)
      setNewKeyName("")
      setSelectedScopes(DEFAULT_SCOPES)
      setCreateOpen(false)
    } catch {
      toast.error(
        t("api_keys.create_failed", {
          defaultValue: "Failed to create API key",
        }),
      )
    }
  }

  const onCopy = async () => {
    if (!createdKey) return
    await navigator.clipboard.writeText(createdKey.key)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const onRevokeConfirm = async () => {
    if (!pendingRevoke) return
    try {
      await revokeKey(pendingRevoke.id)
      toast.success(t("api_keys.revoked", { defaultValue: "API key revoked" }))
    } catch {
      toast.error(
        t("api_keys.revoke_failed", {
          defaultValue: "Failed to revoke API key",
        }),
      )
    } finally {
      setPendingRevoke(null)
    }
  }

  const isActive = (k: ApiKeyPublic) =>
    !k.revoked_at && (!k.expires_at || new Date(k.expires_at) > new Date())

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            id="api-keys"
            className="text-2xl font-semibold flex items-center gap-2"
          >
            <Key className="size-6" />
            {t("api_keys.title", { defaultValue: "API Keys" })}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t("api_keys.description", {
              defaultValue:
                "Personal access tokens that act on your behalf. Use them with agents or scripts to access the Events API.",
            })}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4 mr-1" />
          {t("api_keys.new_key", { defaultValue: "New key" })}
        </Button>
      </div>

      {error && (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-destructive">
              {t("api_keys.load_failed", {
                defaultValue: "Failed to load API keys.",
              })}
            </p>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : keys.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">
              {t("api_keys.empty", {
                defaultValue:
                  "You don't have any API keys yet. Create one to get started.",
              })}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {keys.map((k) => {
            const active = isActive(k)
            return (
              <Card key={k.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-base">{k.name}</CardTitle>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        active
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {active
                        ? t("api_keys.status_active", {
                            defaultValue: "Active",
                          })
                        : k.revoked_at
                          ? t("api_keys.status_revoked", {
                              defaultValue: "Revoked",
                            })
                          : t("api_keys.status_expired", {
                              defaultValue: "Expired",
                            })}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-1">
                  <div className="font-mono text-xs">{k.prefix}…</div>
                  <div>
                    {t("api_keys.scopes", { defaultValue: "Scopes" })}:{" "}
                    {k.scopes.join(", ")}
                  </div>
                  <div>
                    {t("api_keys.created", { defaultValue: "Created" })}:{" "}
                    {format(new Date(k.created_at), "PP")}
                  </div>
                  {k.last_used_at && (
                    <div>
                      {t("api_keys.last_used", {
                        defaultValue: "Last used",
                      })}
                      : {format(new Date(k.last_used_at), "PPp")}
                    </div>
                  )}
                  {k.expires_at && (
                    <div>
                      {t("api_keys.expires", { defaultValue: "Expires" })}:{" "}
                      {format(new Date(k.expires_at), "PP")}
                    </div>
                  )}
                  {active && (
                    <div className="pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPendingRevoke(k)}
                      >
                        <Trash2 className="size-3.5 mr-1" />
                        {t("api_keys.revoke", { defaultValue: "Revoke" })}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("api_keys.create_title", { defaultValue: "Create API key" })}
            </DialogTitle>
            <DialogDescription>
              {t("api_keys.create_description", {
                defaultValue:
                  "Pick a recognisable name. The token will be shown once after creation — copy it then.",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="api-key-name">
              {t("api_keys.name_label", { defaultValue: "Name" })}
            </Label>
            <Input
              id="api-key-name"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder={t("api_keys.name_placeholder", {
                defaultValue: "e.g. Claude assistant",
              })}
              maxLength={100}
              autoFocus
            />
          </div>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>
                {t("api_keys.scopes_label", { defaultValue: "Permissions" })}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("api_keys.scopes_description", {
                  defaultValue:
                    "New keys start with read-only access. Only enable broader permissions when you really need them.",
                })}
              </p>
            </div>
            <div className="space-y-3 rounded-md border p-3">
              {SCOPE_OPTIONS.map((scope) => {
                const checked = selectedScopes.includes(scope.value)
                const checkboxId = `scope-${scope.value}`
                const isComingSoon = scope.value === "events:write"
                return (
                  <div key={scope.value} className="flex items-start gap-3">
                    <Checkbox
                      id={checkboxId}
                      checked={checked}
                      disabled={scope.value === "events:read"}
                      onCheckedChange={(value) =>
                        toggleScope(scope.value, value === true)
                      }
                    />
                    <div className="space-y-1">
                      <Label
                        htmlFor={checkboxId}
                        className="text-sm font-medium cursor-pointer"
                      >
                        {t(`api_keys.scope.${scopeKey(scope.value)}.label`, {
                          defaultValue: scope.label,
                        })}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {t(
                          `api_keys.scope.${scopeKey(scope.value)}.description`,
                          {
                            defaultValue: scope.description,
                          },
                        )}
                      </p>
                      {isComingSoon && (
                        <p className="flex items-center gap-1.5 text-xs font-medium text-green-900">
                          <Info className="size-3.5 shrink-0" />
                          {t("api_keys.scope.events_write.coming_soon", {
                            defaultValue: "Coming to the village in week 2",
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              onClick={onCreate}
              disabled={
                !newKeyName.trim() || isCreating || selectedScopes.length === 0
              }
            >
              {isCreating && <Loader2 className="size-4 animate-spin mr-1" />}
              {t("api_keys.create", { defaultValue: "Create" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createdKey !== null}
        onOpenChange={(open) => {
          if (!open) setCreatedKey(null)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("api_keys.created_title", {
                defaultValue: "API key created",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("api_keys.created_warning", {
                defaultValue:
                  "Copy this token now. You won't be able to see it again — if you lose it, revoke and create a new one.",
              })}
            </DialogDescription>
          </DialogHeader>
          {createdKey && (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                {t("api_keys.created_scopes", {
                  defaultValue: "Permissions",
                })}
                :{" "}
                <span className="font-mono">
                  {createdKey.scopes.join(", ")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-muted rounded text-xs break-all font-mono">
                  {createdKey.key}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={onCopy}
                  aria-label={t("api_keys.copy", { defaultValue: "Copy" })}
                >
                  {copied ? (
                    <Check className="size-4 text-emerald-600" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border border-dashed p-3">
                <p className="text-xs text-muted-foreground">
                  {t("api_keys.created_agent_brief_hint", {
                    defaultValue:
                      "Paste this brief into your agent so it knows how to use the token.",
                  })}
                </p>
                <CopyAgentBrief apiBase={API_BASE} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCreatedKey(null)}>
              {t("api_keys.done", { defaultValue: "Done" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("api_keys.revoke_title", { defaultValue: "Revoke API key" })}
            </DialogTitle>
            <DialogDescription>
              {t("api_keys.revoke_description", {
                defaultValue:
                  "This action cannot be undone. Anything using this token will immediately stop working.",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingRevoke(null)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              variant="destructive"
              onClick={onRevokeConfirm}
              disabled={isRevoking}
            >
              {isRevoking && <Loader2 className="size-4 animate-spin mr-1" />}
              {t("api_keys.revoke", { defaultValue: "Revoke" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function ApiDocsSection() {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h2 className="text-3xl font-semibold">Events API</h2>
        <p className="text-muted-foreground">
          Read events and RSVP on a user's behalf using a portal-issued personal
          access token.
        </p>
      </header>

      <Section
        title="Quick start"
        action={<CopyAgentBrief apiBase={API_BASE} />}
      >
        <div className="rounded-lg border bg-card divide-y text-sm">
          <Row label="API base">
            <code className="font-mono text-xs break-all">
              {`${API_BASE}/api/v1`}
            </code>
            <span className="text-muted-foreground">
              {" "}
              — prefix only; every endpoint path lives beneath it
            </span>
          </Row>
          <Row label="Auth header">
            <code className="font-mono text-xs">
              Authorization: Bearer eos_live_…
            </code>
          </Row>
          <Row label="Get a token">
            <a href="#api-keys" className="underline underline-offset-2">
              Above on this page
            </a>
          </Row>
          <Row label="Scopes available">
            <code className="font-mono text-xs">events:read</code>
            <span className="text-muted-foreground">, </span>
            <code className="font-mono text-xs">events:write</code>
            <span className="text-muted-foreground">, </span>
            <code className="font-mono text-xs">rsvp:write</code>
            <span className="text-muted-foreground">, </span>
            <code className="font-mono text-xs">venues:write</code>
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
            <code className="font-mono text-xs">start_after</code> is set. Pass
            the occurrence's{" "}
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
              <code className="font-mono text-xs w-10 shrink-0">{e.code}</code>
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

        <Endpoint
          method="PATCH"
          path="/api/v1/events/portal/events/{event_id}"
          scope="events:write"
          summary="Update an event you own. Calendar-affecting changes (time, venue, title) bump the sequence and dispatch an iTIP UPDATE."
          body={[
            { name: "title", type: "string" },
            { name: "content", type: "string" },
            { name: "start_time", type: "ISO datetime" },
            { name: "end_time", type: "ISO datetime" },
            { name: "timezone", type: "string" },
            {
              name: "venue_id",
              type: "uuid",
              note: "clears custom_location_*",
            },
            {
              name: "custom_location_name",
              type: "string",
              note: "clears venue_id",
            },
            { name: "custom_location_url", type: "string" },
            { name: "cover_url", type: "string" },
            { name: "meeting_url", type: "string" },
            { name: "max_participant", type: "int" },
            { name: "tags", type: "string[]" },
            { name: "track_id", type: "uuid" },
            {
              name: "visibility",
              type: "enum",
              note: "public | private | unlisted",
            },
            { name: "status", type: "enum" },
            { name: "host_display_name", type: "string" },
          ]}
        />

        <Endpoint
          method="POST"
          path="/api/v1/events/portal/events/{event_id}/cancel"
          scope="events:write"
          summary="Soft-cancel an event you own. Sets status to CANCELLED and dispatches an iTIP CANCEL to attendees. There is no hard-delete."
        />
      </Section>

      <Section title="Invitations" id="invitations">
        <Endpoint
          method="GET"
          path="/api/v1/events/portal/events/{event_id}/invitations"
          scope="events:read"
          summary="List invitations for an event you own."
        />

        <Endpoint
          method="POST"
          path="/api/v1/events/portal/events/{event_id}/invitations"
          scope="events:write"
          summary="Bulk-invite humans by email. Emails must match existing humans in the tenant; unknown addresses come back under not_found. Owner-only."
          body={[
            {
              name: "emails",
              type: "string[]",
              note: "1–1000 entries, case-insensitive",
            },
          ]}
        />

        <Endpoint
          method="DELETE"
          path="/api/v1/events/portal/events/{event_id}/invitations/{invitation_id}"
          scope="events:write"
          summary="Revoke a single invitation. Owner-only."
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

      <Section title="Venues" id="venues">
        <Endpoint
          method="GET"
          path="/api/v1/event-venues/portal/venues"
          scope="events:read"
          summary="List active venues for a popup."
          params={[
            { name: "popup_id", type: "uuid", note: "required" },
            {
              name: "search",
              type: "string",
              note: "fuzzy title/location match",
            },
            { name: "skip", type: "int" },
            { name: "limit", type: "int", note: "max 100" },
          ]}
        />

        <Endpoint
          method="POST"
          path="/api/v1/event-venues/portal/venues"
          scope="venues:write"
          summary="Create a venue you own. Subject to the popup's humans_can_create_venues setting; may be created in PENDING status when the popup requires approval."
          body={[
            { name: "popup_id", type: "uuid" },
            { name: "title", type: "string" },
            { name: "description", type: "string" },
            { name: "location", type: "string" },
            { name: "formatted_address", type: "string" },
            { name: "geo_lat", type: "float" },
            { name: "geo_lng", type: "float" },
            { name: "capacity", type: "int" },
            { name: "image_url", type: "string" },
            { name: "tags", type: "string[]" },
            {
              name: "booking_mode",
              type: "enum",
              note: "free | approval_required | unbookable",
            },
          ]}
        />

        <Endpoint
          method="PATCH"
          path="/api/v1/event-venues/portal/venues/{venue_id}"
          scope="venues:write"
          summary="Update a venue you own. The status field is ignored — re-approval lives in the backoffice."
          body={[
            { name: "title", type: "string" },
            { name: "description", type: "string" },
            { name: "location", type: "string" },
            { name: "capacity", type: "int" },
            { name: "image_url", type: "string" },
            { name: "tags", type: "string[]" },
            { name: "booking_mode", type: "enum" },
          ]}
        />

        <Endpoint
          method="DELETE"
          path="/api/v1/event-venues/portal/venues/{venue_id}"
          scope="venues:write"
          summary="Delete a venue you own. Returns 409 if the venue still has non-cancelled events; remove or reassign them first."
        />
      </Section>
    </div>
  )
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
        {params && params.length > 0 && (
          <FieldList title="Query" items={params} />
        )}
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
            {p.note && (
              <span className="text-muted-foreground"> — {p.note}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Section({
  title,
  id,
  action,
  children,
}: {
  title: string
  id?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section id={id} className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xl font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-baseline gap-4 px-4 py-2">
      <span className="text-xs font-semibold uppercase text-muted-foreground w-32 shrink-0">
        {label}
      </span>
      <span className="text-sm">{children}</span>
    </div>
  )
}
