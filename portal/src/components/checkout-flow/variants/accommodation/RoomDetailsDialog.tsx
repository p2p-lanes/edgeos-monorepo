"use client"

/**
 * One room, given the whole screen.
 *
 * The board has to fit every room at once, so it shows each one a cover
 * photo and two clipped lines of description. That is the right trade for
 * comparing rooms and the wrong one for deciding on the room you have
 * already picked out, which is what this is for: all the photography, the
 * description at full length, the beds itemised, and the property the room
 * belongs to.
 *
 * It also carries the choice. A buyer who opened a room to read about it is
 * mid-decision, and sending them back to the board to hunt for the card they
 * were just looking at is asking them to do the deciding twice.
 *
 * Mounted once by the step rather than once per card: twenty rooms would
 * otherwise mean twenty portals, twenty focus traps and twenty galleries
 * holding their photos, for one dialog that can be open.
 */

import { BedDouble, CalendarClock, Check, MapPin, Users } from "lucide-react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import type { PublicAccommodationProperty } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import type { BoardEntry } from "@/lib/accommodationBoard"
import { RoomGallery } from "./RoomGallery"
import { bedSummary, Price, Scarcity } from "./RoomViews"

interface RoomDetailsDialogProps {
  /** The room being read about, or null when the dialog is closed. */
  entry: BoardEntry | null
  property: PublicAccommodationProperty | undefined
  currency: string | undefined
  nights: number
  selected: boolean
  onClose: () => void
  onSelect: () => void
  onRemove: () => void
}

export function RoomDetailsDialog({
  entry,
  property,
  currency,
  nights,
  selected,
  onClose,
  onSelect,
  onRemove,
}: RoomDetailsDialogProps) {
  const { t } = useTranslation()
  if (!entry) return null

  const { room } = entry
  const beds = bedSummary(room, t)

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl">
        {/* The gallery and the description scroll; the price and the
            decision do not. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <RoomGallery
            key={room.id}
            images={room.images ?? []}
            alt={room.name}
          />

          <div className="flex flex-col gap-5 p-5 sm:p-6">
            <header className="flex flex-col gap-1 pr-8">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t(`checkout.accommodation.kinds.${room.kind}`, {
                  defaultValue: t("checkout.accommodation.kinds.other"),
                })}
              </span>
              <DialogTitle className="text-xl">{room.name}</DialogTitle>
              <DialogDescription>
                {property?.name ?? t("checkout.accommodation.cart_title")}
              </DialogDescription>
              <Scarcity entry={entry} />
            </header>

            <dl className="grid grid-cols-1 gap-3 rounded-xl border bg-muted/30 p-4 sm:grid-cols-3">
              <Fact
                icon={<Users aria-hidden className="h-4 w-4" />}
                label={t("checkout.accommodation.guests_label")}
              >
                {t("checkout.accommodation.sleeps", {
                  count: room.guest_capacity,
                })}
              </Fact>
              {beds && (
                <Fact
                  icon={<BedDouble aria-hidden className="h-4 w-4" />}
                  label={t("checkout.accommodation.beds_label")}
                >
                  {beds}
                </Fact>
              )}
              {room.min_stay > 1 && (
                <Fact
                  icon={<CalendarClock aria-hidden className="h-4 w-4" />}
                  label={t("checkout.accommodation.min_stay_label")}
                >
                  {t("checkout.accommodation.nights", { count: room.min_stay })}
                </Fact>
              )}
            </dl>

            {room.description && (
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {room.description}
              </p>
            )}

            {property && (property.address || property.description) && (
              <section className="flex flex-col gap-2 border-t pt-5">
                <h3 className="font-semibold">
                  {t("checkout.accommodation.about_property", {
                    name: property.name,
                  })}
                </h3>
                {property.address && (
                  <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                    <MapPin aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                    {property.address}
                  </p>
                )}
                {property.description && (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                    {property.description}
                  </p>
                )}
              </section>
            )}
          </div>
        </div>

        {/* The price and the decision stay put while the description scrolls
            past them: this is the one screen where both are the point. */}
        <div className="flex items-center justify-between gap-4 border-t bg-background p-4 sm:px-6">
          <Price entry={entry} currency={currency} nights={nights} />
          {selected ? (
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
                <Check aria-hidden className="h-4 w-4" />
                {t("checkout.accommodation.your_room")}
              </span>
              <Button variant="outline" onClick={onRemove}>
                {t("checkout.accommodation.remove")}
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => {
                onSelect()
                onClose()
              }}
            >
              {t("checkout.accommodation.choose")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Fact({
  icon,
  label,
  children,
}: {
  icon: ReactNode
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-sm font-medium">{children}</dd>
      </div>
    </div>
  )
}
