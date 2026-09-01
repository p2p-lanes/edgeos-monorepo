import { Link } from "@tanstack/react-router"
import { Share2, Ticket, Users } from "lucide-react"

import { InlineRow, InlineSection } from "@/components/ui/inline-form"
import { Separator } from "@/components/ui/separator"

export interface ApplicationAccessSource {
  kind: "group" | "invite" | "referral"
  id: string
  label: string
}

function SourceLink({ source }: { source: ApplicationAccessSource }) {
  const className = "text-sm font-medium hover:text-primary hover:underline"

  if (source.kind === "group") {
    return (
      <Link
        to="/groups/$id/edit"
        params={{ id: source.id }}
        className={className}
      >
        {source.label}
      </Link>
    )
  }
  if (source.kind === "invite") {
    return (
      <Link
        to="/invites/$inviteId/edit"
        params={{ inviteId: source.id }}
        className={className}
      >
        {source.label}
      </Link>
    )
  }
  return (
    <Link
      to="/referrals/$referralId/edit"
      params={{ referralId: source.id }}
      className={className}
    >
      {source.label}
    </Link>
  )
}

export function ApplicationAccessSources({
  sources,
}: {
  sources: ApplicationAccessSource[]
}) {
  if (sources.length === 0) return null

  const sourceMeta = {
    group: { label: "Group", icon: Users },
    invite: { label: "Invite", icon: Ticket },
    referral: { label: "Referral", icon: Share2 },
  } as const

  return (
    <>
      <Separator />
      <InlineSection title="Access sources">
        {sources.map((source) => {
          const meta = sourceMeta[source.kind]
          const Icon = meta.icon
          return (
            <InlineRow
              key={`${source.kind}-${source.id}`}
              icon={<Icon className="size-4 text-muted-foreground" />}
              label={meta.label}
            >
              <SourceLink source={source} />
            </InlineRow>
          )
        })}
      </InlineSection>
    </>
  )
}
