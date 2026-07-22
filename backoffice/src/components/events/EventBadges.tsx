import { Eye, EyeOff, Lock } from "lucide-react"
import type { EventPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const statusColors: Record<string, string> = {
  published: "bg-primary/10 text-primary",
  draft: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/10 text-destructive",
  pending_approval: "bg-warning-soft text-warning",
  rejected: "bg-destructive-soft text-destructive",
}

const statusLabels: Record<string, string> = {
  published: "Published",
  draft: "Draft",
  cancelled: "Cancelled",
  pending_approval: "Pending approval",
  rejected: "Rejected",
}

const visibilityConfig: Record<
  string,
  { label: string; icon: typeof Eye; className: string; iconColor: string }
> = {
  private: {
    label: "Private",
    icon: Lock,
    className: "border-destructive/25 text-destructive bg-destructive-soft",
    iconColor: "text-destructive",
  },
  unlisted: {
    label: "Unlisted",
    icon: EyeOff,
    className: "border-warning/25 text-warning bg-warning-soft",
    iconColor: "text-warning",
  },
  public: {
    label: "Public",
    icon: Eye,
    className: "",
    iconColor: "",
  },
}

interface EventBadgesProps {
  status?: EventPublic["status"]
  visibility?: EventPublic["visibility"]
  /**
   * When false (default), the status badge is only rendered for non-published
   * states (cancelled / draft / pending / rejected) so a normal published event
   * stays uncluttered. The visibility badge is always rendered for
   * private / unlisted events regardless of this flag.
   */
  showPublishedStatus?: boolean
  className?: string
}

/**
 * Compact badges describing an event's publish state and audience visibility.
 *
 * Two distinct concepts are surfaced here so operators don't confuse them
 * (the source of a real Edge Esmeralda incident: a private VIP talk looked
 * identical to a public one in the back office and nobody showed up):
 *   - status      → is the event published / draft / cancelled / etc.
 *   - visibility  → who can see it (public / unlisted / private)
 */
export function EventBadges({
  status,
  visibility,
  showPublishedStatus = false,
  className,
}: EventBadgesProps) {
  const statusKey = status as string | undefined
  const showStatus =
    !!statusKey && (showPublishedStatus || statusKey !== "published")

  const visKey = visibility as string | undefined
  const vis = visKey && visKey !== "public" ? visibilityConfig[visKey] : null
  const VisIcon = vis?.icon

  if (!showStatus && !vis) return null

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {showStatus && (
        <Badge
          variant="secondary"
          className={statusColors[statusKey as string] ?? ""}
        >
          {statusLabels[statusKey as string] ?? statusKey}
        </Badge>
      )}
      {vis && VisIcon && (
        <Badge variant="outline" className={cn("gap-1", vis.className)}>
          <VisIcon className="h-3 w-3" />
          {vis.label}
        </Badge>
      )}
    </div>
  )
}

interface EventVisibilityIconProps {
  visibility?: EventPublic["visibility"]
  className?: string
}

/**
 * Icon-only visibility indicator for space-constrained cards (e.g. the day
 * timeline) where the full {@link EventBadges} text badge would overflow.
 * Renders a colored lock (private) / eye-off (unlisted) glyph and nothing at
 * all for public events, mirroring the badge's "only non-public" behavior.
 */
export function EventVisibilityIcon({
  visibility,
  className,
}: EventVisibilityIconProps) {
  const visKey = visibility as string | undefined
  const vis = visKey && visKey !== "public" ? visibilityConfig[visKey] : null
  if (!vis) return null
  const Icon = vis.icon
  return (
    <Icon
      className={cn("shrink-0", vis.iconColor, className)}
      aria-label={vis.label}
    />
  )
}
