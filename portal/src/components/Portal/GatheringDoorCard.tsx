"use client"

import { useRouter } from "next/navigation"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import type { GatheringDoor } from "@/hooks/useGatheringDoors"

interface GatheringDoorCardProps {
  door: GatheringDoor
  popupSlug: string
  /** False when the gathering has a single door — then it goes unnamed. */
  showName: boolean
}

const STATUS_TONE: Record<GatheringDoor["status"], string> = {
  accepted: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  "in review": "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  draft: "bg-muted text-muted-foreground",
  rejected: "bg-destructive/10 text-destructive",
  none: "bg-muted text-muted-foreground",
}

/**
 * One way this person is part of this gathering.
 *
 * The word "flow" never appears: a buyer has no such concept, so the card
 * shows the name the organiser gave the door — and shows nothing at all
 * when there is only one, which is almost every gathering
 * (sdd/sales-flows-rediseno).
 *
 * A rejected door keeps its card. Removing it would answer "what happened
 * to my application?" by saying nothing, and that silence is what this
 * redesign has been taking out.
 */
export function GatheringDoorCard({
  door,
  popupSlug,
  showName,
}: GatheringDoorCardProps) {
  const router = useRouter()
  const { t } = useTranslation()

  const isAccepted = door.status === "accepted"
  const hasApplied = door.application !== null

  const statusLabel = t(`portal.door_status.${door.status.replace(" ", "_")}`, {
    defaultValue: {
      accepted: "Accepted",
      "in review": "In review",
      draft: "Draft",
      rejected: "Not accepted",
      none: "Open",
    }[door.status],
  })

  const actionLabel = isAccepted
    ? t("portal.door_action.passes", { defaultValue: "View my passes" })
    : hasApplied
      ? t("portal.door_action.application", {
          defaultValue: "View application",
        })
      : t("portal.door_action.apply", { defaultValue: "Apply" })

  const onClick = () => {
    const flow = `?flow=${door.flowId}`
    if (isAccepted) {
      router.push(`/portal/${popupSlug}/passes${flow}`)
      return
    }
    router.push(`/portal/${popupSlug}/application${flow}`)
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        {showName && door.name ? (
          <p className="font-semibold">{door.name}</p>
        ) : (
          <p className="font-semibold text-muted-foreground">
            {t("portal.door_generic", { defaultValue: "Your application" })}
          </p>
        )}
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs ${STATUS_TONE[door.status]}`}
        >
          {statusLabel}
        </span>
      </div>

      {door.application?.attendees?.length ? (
        <p className="text-muted-foreground text-sm">
          {t("portal.door_attendees", {
            count: door.application.attendees.length,
            defaultValue: "{{count}} people",
          })}
        </p>
      ) : null}

      {/* A door that is not accepted yet still needs a way in, and a
          rejected one deliberately offers none. */}
      {door.status !== "rejected" && (
        <Button onClick={onClick} variant={isAccepted ? "default" : "outline"}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
