"use client"

/**
 * What the board is not showing, and how to get it back.
 *
 * This is the half of "hide what cannot be booked" that makes hiding
 * defensible. Without it the buyer compares a short list against nothing,
 * unaware that a room they would have taken is one night or one week away.
 *
 * Only two of the notes carry a button, and neither is decoration: extending
 * the stay and moving to the opening date are both exact, computed from the
 * room's own minimum and window. The rest state a fact and stop, because
 * offering an action that might not work is worse than offering none.
 */

import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import type { Recovery } from "@/lib/accommodationBoard"
import { formatCheckoutDate } from "@/types/checkout"

interface RecoveryNotesProps {
  recoveries: Recovery[]
  guests: number
  onExtendStay: (nights: number) => void
  onMoveStay: (checkIn: string) => void
}

export function RecoveryNotes({
  recoveries,
  guests,
  onExtendStay,
  onMoveStay,
}: RecoveryNotesProps) {
  const { t } = useTranslation()
  if (recoveries.length === 0) return null

  return (
    <ul className="flex flex-col gap-2 rounded-2xl border border-dashed bg-muted/30 p-3">
      {recoveries.map((recovery) => {
        const text =
          recovery.kind === "extend_stay"
            ? t("checkout.accommodation.removed.extend_stay", {
                count: recovery.rooms,
                nights: recovery.nights,
              })
            : recovery.kind === "opens_later"
              ? t("checkout.accommodation.removed.opens_later", {
                  count: recovery.rooms,
                  date: formatCheckoutDate(recovery.date),
                })
              : recovery.kind === "closed_earlier"
                ? t("checkout.accommodation.removed.closed_earlier", {
                    count: recovery.rooms,
                    date: formatCheckoutDate(recovery.date),
                  })
                : recovery.kind === "party_too_big"
                  ? t("checkout.accommodation.removed.party_too_big", {
                      count: recovery.rooms,
                      guests,
                      largest: recovery.largest,
                    })
                  : t("checkout.accommodation.removed.taken", {
                      count: recovery.rooms,
                    })

        return (
          <li
            key={recovery.kind}
            className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
          >
            <span className="min-w-0 flex-1">{text}</span>
            {recovery.kind === "extend_stay" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onExtendStay(recovery.nights)}
              >
                {t("checkout.accommodation.removed.extend_stay_cta", {
                  count: recovery.nights,
                })}
              </Button>
            )}
            {recovery.kind === "opens_later" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onMoveStay(recovery.date)}
              >
                {t("checkout.accommodation.removed.move_stay_cta", {
                  date: formatCheckoutDate(recovery.date),
                })}
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
