"use client"

/**
 * Who this room is booked for, stated rather than asked.
 *
 * This replaces the block that used to open the guest panel with an email
 * and a phone field. There is one payer per cart and one room per checkout,
 * so the contact is the buyer, and the buyer is already known: from the
 * buyer step in a direct sale, from the signed-in account in an application
 * flow. Asking again was asking the same person the same question twice, a
 * step apart, and the second answer had nowhere different to go.
 *
 * The override is the reason this is a row and not a sentence. Booking a
 * room for someone else is ordinary, and a checkout that derives the name
 * silently would put the payer's name on the property's registry with no way
 * to say otherwise. Clearing the field puts the buyer back, so the escape
 * hatch has an obvious way out as well as in.
 *
 * In a direct sale this renders before the buyer step has been reached, so
 * the name is genuinely not known yet. It says so, rather than showing an
 * empty field the buyer would fill in and then be asked for again.
 */

import { Pencil, User } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { BuyerIdentity } from "@/lib/buyerIdentity"

interface BookingContactRowProps {
  identity: BuyerIdentity
  /** The lead occupant's stored name: empty unless the buyer overrode it. */
  name: string
  /** Null when the step does not record occupant names, which makes this
   *  row informational and leaves nothing to override. */
  onNameChange: ((name: string) => void) | null
}

export function BookingContactRow({
  identity,
  name,
  onNameChange,
}: BookingContactRowProps) {
  const { t } = useTranslation()
  const overridden = !!name.trim() && name.trim() !== identity.name
  const [editing, setEditing] = useState(overridden)

  const shown = name.trim() || identity.name

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-background p-3">
      <div className="flex items-start gap-2.5">
        <User aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {shown
              ? t("checkout.accommodation.contact.for", { name: shown })
              : t("checkout.accommodation.contact.pending")}
          </p>
          <p className="text-xs text-muted-foreground">
            {identity.email && !overridden
              ? t("checkout.accommodation.contact.from_you", {
                  email: identity.email,
                })
              : t("checkout.accommodation.contact.hint")}
          </p>
        </div>
        {onNameChange && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <Pencil aria-hidden className="h-3.5 w-3.5" />
            {t("checkout.accommodation.contact.change")}
          </button>
        )}
      </div>

      {onNameChange && editing && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="booking-contact-name">
            {t("checkout.accommodation.contact.name_label")}
          </Label>
          <Input
            id="booking-contact-name"
            value={name}
            autoFocus
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={identity.name || undefined}
          />
          <p className="text-xs text-muted-foreground">
            {t("checkout.accommodation.contact.name_hint")}
          </p>
        </div>
      )}
    </div>
  )
}
