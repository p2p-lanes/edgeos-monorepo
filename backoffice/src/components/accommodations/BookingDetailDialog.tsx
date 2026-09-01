import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ArrowUpRight } from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"

import {
  type AccommodationBookingPublic,
  AccommodationsService,
  type BookingKind,
  type BookingStatus,
  type CalendarBooking,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { bookingAppearance } from "./bookingAppearance"

/**
 * What one bar or one row actually is, plus the two things an operator does
 * about it: move the guest to a different room, or let the room go.
 *
 * Reassigning writes the new `unit_id` and lets the database's exclusion
 * constraint referee it: a 409 back means the target room is taken for those
 * nights, which is the only answer that can be trusted under concurrency.
 */

export interface BookingDetail {
  id: string
  accommodationId: string
  unitId: string
  kind: BookingKind
  status: BookingStatus
  checkIn: string
  checkOut: string
  nights: number
  guestCount?: number | null
  guestName?: string | null
  guestEmail?: string | null
  paymentId?: string | null
  total?: string | null
  notes?: string | null
}

export function detailFromCalendar(booking: CalendarBooking): BookingDetail {
  return {
    id: booking.id,
    accommodationId: booking.accommodation_id,
    unitId: booking.unit_id,
    kind: booking.kind,
    status: booking.status,
    checkIn: booking.check_in,
    checkOut: booking.check_out,
    nights: booking.nights,
    guestCount: booking.guest_count,
    guestName: booking.primary_guest_name,
    guestEmail: booking.primary_guest_email,
    paymentId: booking.payment_id,
    total: booking.total,
    notes: booking.notes,
  }
}

export function detailFromRow(
  booking: AccommodationBookingPublic,
): BookingDetail {
  const snapshot = booking.price_snapshot as { total?: unknown } | null
  return {
    id: booking.id,
    accommodationId: booking.accommodation_id,
    unitId: booking.unit_id,
    kind: booking.kind ?? "guest",
    status: booking.status ?? "confirmed",
    checkIn: booking.check_in,
    checkOut: booking.check_out,
    nights: booking.nights ?? 0,
    guestCount: booking.guest_count,
    guestName: booking.primary_guest_name,
    guestEmail: booking.primary_guest_email,
    paymentId: booking.payment_id,
    total: snapshot?.total == null ? null : String(snapshot.total),
    notes: booking.notes,
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm">{children}</span>
    </div>
  )
}

interface BookingDetailDialogProps {
  booking: BookingDetail | null
  roomName: string
  units: { id: string; label: string }[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BookingDetailDialog({
  booking,
  roomName,
  units,
  open,
  onOpenChange,
}: BookingDetailDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [targetUnit, setTargetUnit] = useState<string | null>(null)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["accommodations"] })

  const reassign = useMutation({
    mutationFn: (unitId: string) =>
      AccommodationsService.updateBooking({
        bookingId: booking?.id as string,
        requestBody: { unit_id: unitId },
      }),
    onSuccess: () => {
      showSuccessToast("Moved to the other unit")
      setTargetUnit(null)
      invalidate()
      onOpenChange(false)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const cancel = useMutation({
    mutationFn: () =>
      AccommodationsService.updateBooking({
        bookingId: booking?.id as string,
        requestBody: { status: "cancelled" },
      }),
    onSuccess: () => {
      showSuccessToast("The room is free again")
      invalidate()
      onOpenChange(false)
    },
    onError: createErrorHandler(showErrorToast),
  })

  if (!booking) return null

  const appearance = bookingAppearance(booking)
  const isBlock = booking.kind === "block" || booking.kind === "maintenance"
  const isReleased =
    booking.status === "cancelled" || booking.status === "expired"
  const currentUnit = units.find((unit) => unit.id === booking.unitId)
  const otherUnits = units.filter((unit) => unit.id !== booking.unitId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isBlock ? "Blocked dates" : booking.guestName || "Guest"}
            <Badge className={cn("font-normal", appearance.className)}>
              {appearance.label}
            </Badge>
          </DialogTitle>
          <DialogDescription>{appearance.description}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Room type">{roomName}</Field>
          <Field label="Unit">{currentUnit?.label ?? "—"}</Field>
          <Field label="Dates">
            {booking.checkIn} → {booking.checkOut}
          </Field>
          <Field label="Nights">{booking.nights}</Field>
          {!isBlock && (
            <>
              <Field label="Guests">{booking.guestCount ?? "—"}</Field>
              <Field label="Total">{booking.total ?? "—"}</Field>
            </>
          )}
          {booking.guestEmail && (
            <div className="col-span-2">
              <Field label="Email">{booking.guestEmail}</Field>
            </div>
          )}
          {booking.notes && (
            <div className="col-span-2">
              <Field label="Notes">{booking.notes}</Field>
            </div>
          )}
        </div>

        {booking.paymentId && booking.guestEmail && (
          <Link
            to="/payments"
            search={{ search: booking.guestEmail }}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Find this payment
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        )}

        {!isReleased && otherUnits.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-lg border p-3">
            <Label htmlFor="reassign-unit">Move to another unit</Label>
            <div className="flex gap-2">
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
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {!isReleased && (
            <LoadingButton
              variant="destructive"
              loading={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              {isBlock ? "Unblock" : "Cancel booking"}
            </LoadingButton>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
