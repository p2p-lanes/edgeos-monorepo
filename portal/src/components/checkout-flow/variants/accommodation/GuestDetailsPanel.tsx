"use client"

import { useState } from "react"
import { useTranslation } from "react-i18next"

import { DynamicField } from "@/app/portal/[popupSlug]/application/components/fields/dynamic-field"
import {
  bookerFieldsAsked,
  checkField,
  completeGuestCount,
  fieldsAskedOf,
  guestFieldsOf,
} from "@/lib/accommodationForm"
import { useCheckout } from "@/providers/checkoutProvider"
import {
  formatCheckoutDate,
  type SelectedAccommodationItem,
} from "@/types/checkout"
import { BookingContactRow } from "./BookingContactRow"
import { GuestCard, toSchema } from "./GuestCard"

interface GuestDetailsPanelProps {
  item: SelectedAccommodationItem
  requireGuestNames: boolean
}

/**
 * Who is staying in one booked room, and what the property needs to know
 * that nobody has already answered.
 *
 * The panel used to open by asking the buyer for their own email, name and
 * phone, and the buyer step asked for the same things again a few screens
 * later. Those questions are gone: the lead occupant is the buyer, so what
 * the checkout already knows about them is struck off the list here and
 * folded back in on the way to the server. What is left is genuinely about
 * the stay, which is the only thing worth a form in the middle of a booking.
 *
 * The consequence worth stating: with a party of one and no extra questions,
 * this panel is a single line saying whose room it is. That is the common
 * case, and it used to be a form.
 *
 * What each occupant is asked is still decided by the server and arrives
 * resolved on the room's step config, so this renders a form rather than
 * deciding one.
 */
export function GuestDetailsPanel({
  item,
  requireGuestNames,
}: GuestDetailsPanelProps) {
  const { t } = useTranslation()
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const {
    buyerIdentity,
    setAccommodationGuestName,
    setAccommodationBookerAnswer,
    setAccommodationGuestAnswer,
    copyBookerAnswersToGuest,
  } = useCheckout()

  const bookerFields = bookerFieldsAsked(item.guestForm, buyerIdentity)
  const guestFields = guestFieldsOf(item.guestForm)
  const sharedKeys = guestFields
    .map((field) => field.key)
    .filter((key) => bookerFields.some((field) => field.key === key))
  const complete = completeGuestCount(item, {
    requireGuestNames,
    identity: buyerIdentity,
  })

  /** The lead occupant's name is the contact row's job, never a card's. */
  const leadNamedAbove = requireGuestNames || buyerIdentity.namesLeadGuest
  const asksOf = (index: number) =>
    fieldsAskedOf(guestFields, index, buyerIdentity)
  const cardIndexes = Array.from(
    { length: item.guestCount },
    (_, index) => index,
  ).filter((index) =>
    // The buyer is on the contact row already, so their card earns its
    // place only by asking something. Everyone else is a person this
    // checkout has never heard of and always gets one.
    index > 0
      ? requireGuestNames || guestFields.length > 0
      : asksOf(0).length > 0,
  )

  const where = `${item.propertyName} Â· ${formatCheckoutDate(item.checkIn)} â†’ ${formatCheckoutDate(item.checkOut)}`

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-muted/30 p-4">
      <div className="min-w-0">
        {/* No party-size input here any more: it moved above the rooms,
            where it filters which rooms exist rather than resizing a booking
            that was already made against a room that may not fit. */}
        <p className="font-medium">{item.name}</p>
        <p className="truncate text-xs text-muted-foreground">{where}</p>
      </div>

      {(leadNamedAbove || buyerIdentity.name || buyerIdentity.email) && (
        <BookingContactRow
          identity={buyerIdentity}
          name={item.guests[0]?.name ?? ""}
          onNameChange={
            leadNamedAbove
              ? (name) =>
                  setAccommodationGuestName(
                    item.accommodationId,
                    item.checkIn,
                    item.checkOut,
                    0,
                    name,
                  )
              : null
          }
        />
      )}

      {bookerFields.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border bg-background p-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium">
              {/* Not "lead guest": that is the first occupant below, and
                  naming both the same thing makes the panel unreadable. This
                  block is about the room, asked once. */}
              {item.guestForm?.booker?.title ||
                t("checkout.accommodation.form.booking_contact")}
            </p>
            <p className="text-xs text-muted-foreground">
              {item.guestForm?.booker?.description ||
                t("checkout.accommodation.form.booking_contact_hint")}
            </p>
          </div>
          {bookerFields.map((field) => {
            const error = checkField(field, item.bookerAnswers)
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: a blur listener is not an interaction; it exists to know when the buyer has left the field, so the error appears then rather than at the third keystroke
              <div
                key={field.key}
                // Errors after the field is left, not while it is being
                // typed in: flagging a half-typed email is telling someone
                // off for not having finished.
                onBlur={() =>
                  setTouched((prev) => ({ ...prev, [field.key]: true }))
                }
              >
                <DynamicField
                  name={field.key}
                  field={toSchema(field)}
                  value={item.bookerAnswers[field.key] ?? ""}
                  error={touched[field.key] && error ? error : undefined}
                  onChange={(_name, value) =>
                    setAccommodationBookerAnswer(
                      item.accommodationId,
                      item.checkIn,
                      item.checkOut,
                      field.key,
                      value,
                    )
                  }
                />
              </div>
            )
          })}
        </div>
      )}

      {cardIndexes.length > 0 && (
        <div className="flex flex-col gap-2">
          {cardIndexes.map((index) => (
            <GuestCard
              // Positional slots: a guest has no id until the booking exists,
              // and this list never reorders.
              key={index}
              index={index}
              guest={item.guests[index] ?? { name: "", answers: {} }}
              fields={asksOf(index)}
              requireName={requireGuestNames && index > 0}
              defaultOpen={index === cardIndexes[0]}
              copyableKeys={index > 0 ? sharedKeys : []}
              summary={
                index === 0
                  ? buyerIdentity.name ||
                    t("checkout.accommodation.contact.you")
                  : undefined
              }
              onName={(name) =>
                setAccommodationGuestName(
                  item.accommodationId,
                  item.checkIn,
                  item.checkOut,
                  index,
                  name,
                )
              }
              onAnswer={(key, value) =>
                setAccommodationGuestAnswer(
                  item.accommodationId,
                  item.checkIn,
                  item.checkOut,
                  index,
                  key,
                  value,
                )
              }
              onCopyFromLead={() =>
                copyBookerAnswersToGuest(
                  item.accommodationId,
                  item.checkIn,
                  item.checkOut,
                  index,
                  sharedKeys,
                )
              }
            />
          ))}

          <p className="text-xs text-muted-foreground">
            {t("checkout.accommodation.form.progress", {
              complete,
              total: item.guestCount,
            })}
          </p>
        </div>
      )}
    </div>
  )
}
