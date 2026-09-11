"use client"

/**
 * The chosen room, once there is nothing left to compare it against.
 *
 * The board exists to be scanned: three layouts, because twenty dorm beds
 * and four photographed suites want different amounts of the screen. The
 * moment one room is chosen, all of that stops paying for itself. There is
 * no comparison left to make, the rooms underneath are only in the way of
 * the form the buyer now has to fill in, and the layout that helped them
 * choose has no opinion about what a made decision looks like. So all three
 * layouts collapse to this one line, and the step goes from "which of
 * these" to "this one, and here is what we still need".
 *
 * It reads from the cart, not from the board, so it is on screen before the
 * night's availability has been re-priced and stays on screen while it is
 * being re-priced. The board is only consulted for the room's own screen,
 * which is why `onOpenDetails` is optional.
 *
 * Still a radio, still checked, still releases the room when it is clicked:
 * the board it replaces put the way out where the way in was, and the room
 * not moving when it collapses is what makes the two read as the same
 * control. The explicit button beside it is for the buyer who does not
 * expect that, which is most of them.
 */

import { Check, Repeat2 } from "lucide-react"
import Image from "next/image"
import type { KeyboardEvent } from "react"
import { useTranslation } from "react-i18next"
import { imageOptimization } from "@/lib/image-optimization"
import { cn } from "@/lib/utils"
import {
  formatCheckoutDate,
  formatCurrency,
  type SelectedAccommodationItem,
} from "@/types/checkout"

interface SelectedRoomSummaryProps {
  item: SelectedAccommodationItem
  currency: string | undefined
  /** Absent until the room is back on a priced board: nothing to open yet. */
  onOpenDetails?: () => void
  /** Let the room go, which is what brings every other room back. */
  onRelease: () => void
}

export function SelectedRoomSummary({
  item,
  currency,
  onOpenDetails,
  onRelease,
}: SelectedRoomSummaryProps) {
  const { t } = useTranslation()

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Only from the card surface itself, so Enter on a button inside it
    // does that button's job rather than throwing the room away.
    if (event.target !== event.currentTarget) return
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    onRelease()
  }

  const stay = [
    `${formatCheckoutDate(item.checkIn)} → ${formatCheckoutDate(item.checkOut)}`,
    t("checkout.accommodation.nights", { count: item.nights }),
    t("checkout.accommodation.guests", { count: item.guestCount }),
  ].join(" · ")

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {t("checkout.accommodation.your_room")}
        </p>
        <button
          type="button"
          onClick={onRelease}
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium text-xs transition-colors hover:bg-muted"
        >
          <Repeat2 aria-hidden className="h-3.5 w-3.5" />
          {t("checkout.accommodation.change_room")}
        </button>
      </div>

      <div role="radiogroup" aria-label={t("checkout.accommodation.your_room")}>
        {/* biome-ignore lint/a11y/useSemanticElements: a real radio input cannot contain the button this card contains */}
        <div
          role="radio"
          aria-checked={true}
          tabIndex={0}
          onClick={onRelease}
          onKeyDown={onKeyDown}
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-2xl border border-primary bg-primary/5 p-3 text-left ring-1 ring-primary",
            "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <span
            aria-hidden
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-primary text-primary-foreground"
          >
            <Check className="h-3 w-3" />
          </span>

          {item.imageUrl ? (
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl">
              <Image
                src={item.imageUrl}
                alt={item.name}
                fill
                sizes="56px"
                className="object-cover"
                {...imageOptimization(item.imageUrl)}
              />
            </div>
          ) : (
            <div className="h-14 w-14 shrink-0 rounded-xl bg-muted" />
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-tight">{item.name}</p>
            {item.propertyName && (
              <p className="truncate text-muted-foreground text-xs">
                {item.propertyName}
              </p>
            )}
            <p className="truncate text-muted-foreground text-xs">{stay}</p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <span className="font-semibold text-lg leading-tight">
              {formatCurrency(item.totalPrice, currency)}
            </span>
            {item.tax > 0 && (
              <span className="text-muted-foreground text-xs">
                {t("checkout.accommodation.includes_tax", {
                  amount: formatCurrency(item.tax, currency),
                })}
              </span>
            )}
            {onOpenDetails && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenDetails()
                }}
                className="font-medium text-primary text-xs underline-offset-2 hover:underline"
              >
                {t("checkout.accommodation.view_details")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
