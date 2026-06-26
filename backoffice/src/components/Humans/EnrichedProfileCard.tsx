import { useQuery } from "@tanstack/react-query"
import { ChevronDown, ExternalLink } from "lucide-react"
import { useState } from "react"

import { type HumanPublic, HumansService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"

/**
 * The curated `enriched_profile` is free-form JSONB (the enrichment agent can
 * evolve it without a migration), so we read it defensively: pull the known
 * fields when present and the right type, ignore the rest.
 */
type EnrichedProfile = {
  headline?: string
  bio?: string
  organization?: string
  role?: string
  tags: string[]
  interests: string[]
  topics: string[]
  links: string[]
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v !== "")
}

function parseEnrichedProfile(
  raw: HumanPublic["enriched_profile"],
): EnrichedProfile | null {
  if (!raw || typeof raw !== "object") return null
  const p = raw as Record<string, unknown>
  return {
    headline: asString(p.headline),
    bio: asString(p.bio),
    organization: asString(p.organization),
    role: asString(p.role),
    tags: asStringList(p.tags),
    interests: asStringList(p.interests),
    topics: asStringList(p.topics),
    links: asStringList(p.links),
  }
}

function isEmptyProfile(p: EnrichedProfile): boolean {
  return (
    !p.headline &&
    !p.bio &&
    !p.organization &&
    !p.role &&
    p.tags.length === 0 &&
    p.interests.length === 0 &&
    p.topics.length === 0 &&
    p.links.length === 0
  )
}

function linkLabel(url: string): string {
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`)
    return `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`
  } catch {
    return url
  }
}

/** The two Telegram groups we enriched from — for a human-readable source label. */
const TELEGRAM_GROUPS: Record<string, string> = {
  "2944565963": "Edge City Patagonia 2025",
  "3980048315": "Edge Esmeralda 2026",
}

/**
 * Provenance facts were written by two passes with different `evidence` shapes:
 * a proper `https://t.me/c/<chat>/<msg>` deep link, and a bare `<chat>:<msg>`
 * (which the browser resolves as a relative path → 404). Normalize both to a
 * valid Telegram deep link, preferring the structured `raw` payload when present.
 */
function factEvidence(f: {
  evidence?: string | null
  raw?: { [key: string]: unknown } | null
}): { href: string; label: string } | null {
  let chat: string | undefined
  let msg: string | undefined

  const raw = f.raw
  if (raw && typeof raw === "object") {
    if (raw.chat_id != null) chat = String(raw.chat_id)
    if (raw.message_id != null) msg = String(raw.message_id)
  }

  const ev = f.evidence?.trim()
  if (ev) {
    if (/^https?:\/\//i.test(ev)) {
      const m = ev.match(/t\.me\/c\/(\d+)\/(\d+)/)
      const label =
        m && TELEGRAM_GROUPS[m[1]] ? TELEGRAM_GROUPS[m[1]] : "Telegram"
      return { href: ev, label }
    }
    const m = ev.match(/^(\d+):(\d+)$/)
    if (m) {
      chat = chat ?? m[1]
      msg = msg ?? m[2]
    }
  }

  if (chat && msg) {
    const label = TELEGRAM_GROUPS[chat] ?? "Telegram"
    return { href: `https://t.me/c/${chat}/${msg}`, label }
  }
  return null
}

function BadgeRow({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <Badge key={v} variant="secondary" className="font-normal">
            {v}
          </Badge>
        ))}
      </div>
    </div>
  )
}

/** Collapsible provenance log: where each fact in the profile came from. */
function EnrichmentFacts({ humanId }: { humanId: string }) {
  const [open, setOpen] = useState(false)
  const { data } = useQuery({
    queryKey: ["human-enrichment-facts", humanId],
    queryFn: () => HumansService.listHumanEnrichmentFacts({ humanId }),
    enabled: open,
  })
  const facts = data?.results ?? []

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          />
          Sources{data ? ` (${facts.length})` : ""}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">
        {facts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No provenance facts recorded yet.
          </p>
        ) : (
          facts.map((f) => (
            <div
              key={f.id}
              className="rounded-md border bg-muted/30 p-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{f.field}</span>
                <Badge variant="outline" className="font-normal">
                  {f.source}
                </Badge>
              </div>
              <p className="mt-1 text-foreground/80">{f.value}</p>
              {(() => {
                const ev = factEvidence(f)
                return ev ? (
                  <a
                    href={ev.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-primary underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {ev.label}
                  </a>
                ) : null
              })()}
            </div>
          ))
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Renders a human's curated rich profile (maintained by the enrichment agent;
 * admins may also hand-edit it). Shows nothing actionable when the human has
 * never been enriched — just a hint.
 */
export function EnrichedProfileCard({ human }: { human: HumanPublic }) {
  const profile = parseEnrichedProfile(human.enriched_profile)

  return (
    <div className="space-y-3">
      {!profile || isEmptyProfile(profile) ? (
        <p className="text-sm text-muted-foreground">
          There is no additional information for this profile.
        </p>
      ) : (
        <div className="space-y-4">
          {(profile.headline || profile.role || profile.organization) && (
            <div className="space-y-0.5">
              {profile.headline && (
                <p className="font-medium leading-snug">{profile.headline}</p>
              )}
              {(profile.role || profile.organization) && (
                <p className="text-sm text-muted-foreground">
                  {[profile.role, profile.organization]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
          )}

          {profile.bio && (
            <p className="whitespace-pre-wrap text-sm text-foreground/90">
              {profile.bio}
            </p>
          )}

          {(profile.tags.length > 0 ||
            profile.interests.length > 0 ||
            profile.topics.length > 0 ||
            profile.links.length > 0) && (
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <BadgeRow label="Tags" values={profile.tags} />
              <BadgeRow label="Interests" values={profile.interests} />
              <BadgeRow label="Topics" values={profile.topics} />
              {profile.links.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    Links
                  </p>
                  <div className="flex flex-col gap-1">
                    {profile.links.map((url) => (
                      <a
                        key={url}
                        href={url.includes("://") ? url : `https://${url}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-primary underline"
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        {linkLabel(url)}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <Separator />
      <EnrichmentFacts humanId={human.id} />
    </div>
  )
}
