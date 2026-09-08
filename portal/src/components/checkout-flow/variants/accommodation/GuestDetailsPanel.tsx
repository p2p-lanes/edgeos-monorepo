"use client"

import { useState } from "react"
import { useTranslation } from "react-i18next"

import { DynamicField } from "@/app/portal/[popupSlug]/application/components/fields/dynamic-field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  bookerFieldsOf,
  checkField,
  completeGuestCount,
  guestFieldsOf,
} from "@/lib/accommodationForm"
import { useCheckout } from "@/providers/checkoutProvider"
import {
  formatCheckoutDate,
  type SelectedAccommodationItem,
} from "@/types/checkout"
import { GuestCard, toSchema } from "./GuestCard"

interface GuestDetailsPanelProps {
  item: SelectedAccommodationItem
  capacity: number
  requireGuestNames: boolean
}

/**
 * Who is staying in one booked room, and what the property needs to know.
 *
 * The lead guest is asked once for the room; everyone else is asked whatever
 * the property repeats per occupant, in a card of their own. What each is
 * asked is decided by the server and arrives resolved on the room's property,
 * so this renders a form rather than deciding one.
 */
export function GuestDetailsPanel({
  item,
  capacity,
  requireGuestNames,
}: GuestDetailsPanelProps) {
  const { t } = useTranslation()
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const {
    setAccommodationGuestCount,
    setAccommodationGuestName,
    setAccommodationBookerAnswer,
    setAccommodationGuestAnswer,
    copyBookerAnswersToGuest,
  } = useCheckout()

  const bookerFields = bookerFieldsOf(item.guestForm)
  const guestFields = guestFieldsOf(item.guestForm)
  const sharedKeys = guestFields
    .map((field) => field.key)
    .filter((key) => bookerFields.some((field) => field.key === key))
  const complete = completeGuestCount(item, { requireGuestNames })
  const asksPerGuest = requireGuestNames || guestFields.length > 0

  const where = `${item.propertyName} · ${formatCheckoutDate(item.checkIn)} → ${formatCheckoutDate(item.checkOut)}`

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-muted/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{item.name}</p>
          <p className="truncate text-xs text-muted-foreground">{where}</p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`guests-${item.accommodationId}`} className="text-xs">
            {t("checkout.accommodation.guests_label")}
          </Label>
          <Input
            id={`guests-${item.accommodationId}`}
            type="number"
            min={1}
            max={capacity}
            className="w-20"
            value={item.guestCount}
            onChange={(event) =>
              setAccommodationGuestCount(
                item.accommodationId,
                item.checkIn,
                item.checkOut,
                Number(event.target.value) || 1,
              )
            }
          />
        </div>
      </div>

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

      {asksPerGuest && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: item.guestCount }, (_, index) => (
            <GuestCard
              // Positional slots: a guest has no id until the booking exists,
              // and this list never reorders.
              key={index}
              index={index}
              guest={item.guests[index] ?? { name: "", answers: {} }}
              fields={guestFields}
              requireName={requireGuestNames}
              defaultOpen={index === 0}
              copyableKeys={sharedKeys}
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
