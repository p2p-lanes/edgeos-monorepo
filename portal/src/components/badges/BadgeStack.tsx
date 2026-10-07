import { Award } from "lucide-react"
import Image from "next/image"
import type { BadgeSummary } from "@/client"
import { imageOptimization } from "@/lib/image-optimization"
import { cn } from "@/lib/utils"

interface BadgeStackProps {
  badges: BadgeSummary[]
  /** How many to draw before collapsing the rest into "+N". */
  max?: number
  className?: string
}

/** Badge artwork overlapped like a hand of cards, with "+N" for the rest. */
export function BadgeStack({ badges, max = 4, className }: BadgeStackProps) {
  const shown = badges.slice(0, max)
  const hidden = badges.length - shown.length

  return (
    <div className={cn("flex items-center", className)}>
      {shown.map((badge, index) => (
        <span
          key={badge.id}
          title={badge.name}
          // Earlier badges sit on top, so the first one reads as the lead.
          style={{ zIndex: shown.length - index }}
          className={cn(
            "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card p-1 shadow-sm ring-2 ring-background",
            index > 0 && "-ml-3",
          )}
        >
          {badge.image_url ? (
            <span className="relative h-full w-full">
              <Image
                src={badge.image_url}
                alt={badge.name}
                fill
                sizes="40px"
                className="object-contain"
                {...imageOptimization(badge.image_url)}
              />
            </span>
          ) : (
            <Award
              className="h-5 w-5 text-muted-foreground"
              aria-label={badge.name}
            />
          )}
        </span>
      ))}
      {hidden > 0 && (
        <span className="-ml-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground ring-2 ring-background">
          +{hidden}
        </span>
      )}
    </div>
  )
}
