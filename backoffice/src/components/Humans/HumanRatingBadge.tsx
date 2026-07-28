import type { HumanRating } from "@/client"
import { ratingMeta } from "@/components/Humans/humanFields"
import { Badge } from "@/components/ui/badge"

/**
 * The human's admin rating as a badge. Hidden for unrated by default (noise in
 * most contexts); pass `showUnrated` where an explicit "No rating" is useful
 * (e.g. the human's own assessment card).
 */
export function HumanRatingBadge({
  rating,
  showUnrated = false,
}: {
  rating?: HumanRating | null
  showUnrated?: boolean
}) {
  const meta = ratingMeta(rating)
  if (!showUnrated && meta.value === "unrated") return null
  return <Badge variant={meta.badge}>{meta.label}</Badge>
}
