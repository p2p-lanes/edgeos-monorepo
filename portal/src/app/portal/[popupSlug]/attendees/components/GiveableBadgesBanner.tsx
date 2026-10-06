import { useTranslation } from "react-i18next"
import type { IssuableBadge } from "@/client"
import { BadgeStack } from "@/components/badges/BadgeStack"
import { cn } from "@/lib/utils"

/** Tells the viewer they have badges to give, and how to give them. */
const GiveableBadgesBanner = ({ issuable }: { issuable: IssuableBadge[] }) => {
  const { t } = useTranslation()
  if (issuable.length === 0) return null

  const available = issuable.filter((item) => item.remaining !== 0)
  const allUsed = available.length === 0

  return (
    <div className="mb-4 flex items-center gap-4 rounded-xl border bg-card p-4">
      <BadgeStack
        badges={(allUsed ? issuable : available).map((item) => item.badge)}
        className={cn(allUsed && "opacity-50 grayscale")}
      />
      <div className="min-w-0">
        <p className="font-medium text-foreground">
          {allUsed
            ? t("attendees.badges.banner_all_used")
            : t("attendees.badges.banner_title", { count: available.length })}
        </p>
        <p className="text-sm text-muted-foreground">
          {allUsed
            ? t("attendees.badges.banner_all_used_hint")
            : t("attendees.badges.banner_hint")}
        </p>
      </div>
    </div>
  )
}

export default GiveableBadgesBanner
