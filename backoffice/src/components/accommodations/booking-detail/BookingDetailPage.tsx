import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ArrowUpRight } from "lucide-react"
import { useState } from "react"

import {
  type AccommodationBookingDetail,
  AccommodationsService,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import useCustomToast from "@/hooks/useCustomToast"
import { cn } from "@/lib/utils"
import { createErrorHandler } from "@/utils"
import { bookingAppearance } from "../bookingAppearance"
import { chargeOf, personBlocks } from "./bookingDetail"
import { GuestDetailsCard } from "./GuestDetailsCard"
import { StayBand } from "./StayBand"

/**
 * One booking, on its own screen.
 *
 * This was a modal, and it had outgrown one: a guest form can ask six
 * questions of four people, and none of that fits beside a reassignment
 * control in a 448px dialog.
 *
 * The split is by what an operator is doing. The left column is the stay and
 * the people, which is what they came to read. The right column is what they
 * came to change, ending with the one destructive action, kept off the
 * reading path rather than sitting under the guest list where a misclick
 * lives.
 */
export function BookingDetailPage({
  booking,
  onReleased,
}: {
  booking: AccommodationBookingDetail
  onReleased: () => void
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [targetUnit, setTargetUnit] = useState<string | null>(null)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["accommodations"] })

  const reassign = useMutation({
    mutationFn: (unitId: string) =>
      AccommodationsService.updateBooking({
        bookingId: booking.id,
        requestBody: { unit_id: unitId },
      }),
    onSuccess: () => {
      showSuccessToast("Moved to the other unit")
      setTargetUnit(null)
      invalidate()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const release = useMutation({
    mutationFn: () =>
      AccommodationsService.updateBooking({
        bookingId: booking.id,
        requestBody: { status: "cancelled" },
      }),
    onSuccess: () => {
      showSuccessToast("The room is free again")
      invalidate()
      onReleased()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const appearance = bookingAppearance(booking)
  const isBlock = booking.kind === "block" || booking.kind === "maintenance"
  const isReleased =
    booking.status === "cancelled" || booking.status === "expired"
  const otherUnits = (booking.units ?? []).filter(
    (unit) => unit.id !== booking.unit_id,
  )
  const blocks = isBlock ? [] : personBlocks(booking)
  const charge = isBlock ? null : chargeOf(booking.price_snapshot)

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <StayBand
          checkIn={booking.check_in}
          checkOut={booking.check_out}
          nights={booking.nights ?? 0}
          propertyName={booking.property_name}
          propertyAddress={booking.property_address}
          accommodationName={booking.accommodation_name}
          unitLabel={booking.unit_label}
        />

        {blocks.length > 0 && (
          <GuestDetailsCard blocks={blocks} guestCount={booking.guest_count} />
        )}

        {!isBlock && blocks.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Guest details</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Nobody was named on this booking. The accommodation step decides
              what the checkout asks about the people staying.
            </CardContent>
          </Card>
        )}

        {booking.notes && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent className="whitespace-pre-wrap text-sm">
              {booking.notes}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Badge className={cn("w-fit font-normal", appearance.className)}>
              {appearance.label}
            </Badge>
            <p className="text-sm text-muted-foreground">
              {appearance.description}
            </p>
          </CardContent>
        </Card>

        {charge && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Charged</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <Amount label="Subtotal" value={charge.subtotal} />
              <Amount label="Tax" value={charge.tax} />
              <div className="mt-1 flex items-baseline justify-between border-t pt-2">
                <span className="font-medium">Total</span>
                <span className="font-semibold tabular-nums">
                  {charge.total} {charge.currency}
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {!isReleased && otherUnits.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Move to another unit</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Label htmlFor="reassign-unit" className="sr-only">
                Unit
              </Label>
              <Select
                value={targetUnit ?? ""}
                onValueChange={(value) => setTargetUnit(value)}
              >
                <SelectTrigger id="reassign-unit">
                  <SelectValue placeholder="Pick a unit" />
                </SelectTrigger>
                <SelectContent>
                  {otherUnits.map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {unit.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <LoadingButton
                variant="outline"
                loading={reassign.isPending}
                disabled={!targetUnit}
                onClick={() => targetUnit && reassign.mutate(targetUnit)}
              >
                Move
              </LoadingButton>
              <p className="text-xs text-muted-foreground">
                Refused if the unit is already taken for these nights.
              </p>
            </CardContent>
          </Card>
        )}

        {booking.primary_guest_email && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contact</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-start gap-2 text-sm">
              <span>{booking.primary_guest_email}</span>
              {booking.payment_id && (
                <Link
                  to="/payments"
                  search={{ search: booking.primary_guest_email }}
                  className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Find this payment
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </CardContent>
          </Card>
        )}

        {!isReleased && (
          <LoadingButton
            variant="destructive"
            loading={release.isPending}
            onClick={() => release.mutate()}
          >
            {isBlock ? "Unblock these dates" : "Cancel booking"}
          </LoadingButton>
        )}
      </div>
    </div>
  )
}

function Amount({ label, value }: { label: string; value?: string }) {
  if (value === undefined) return null
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}
