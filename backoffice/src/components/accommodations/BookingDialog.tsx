import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { TriangleAlert } from "lucide-react"
import { useState } from "react"

import {
  type AccommodationPublic,
  AccommodationsService,
  type BookingKind,
  PopupsService,
} from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { cn } from "@/lib/utils"
import { createErrorHandler } from "@/utils"
import { addDays, todayKey } from "./calendarLayout"
import { checkStay, type StayProblemField } from "./stayRules"

/**
 * Booking a room by hand, and taking rooms off the market.
 *
 * Both exist because the checkout is not the only way a room fills up: an
 * organiser comps a speaker, a guest calls, a floor gets repainted. Staff
 * bookings are confirmed immediately (there is no payment to wait for) and
 * may ignore the min-stay and bookable-window rules, which shape what guests
 * can buy rather than what the operator can arrange.
 *
 * Those rules are checked here as the operator types, and block the submit
 * until either the dates are fixed or the override is turned on deliberately.
 * The server checks them too and is still the authority; the point of doing
 * it twice is that a refusal arrives as a sentence next to the field, before
 * the button, rather than as a 422 after it.
 */

const ANY_UNIT = "any"

interface Prefill {
  accommodationId?: string
  unitId?: string
  checkIn?: string
}

function useRooms(popupId: string) {
  return useQuery({
    queryKey: ["accommodations", "rooms", popupId],
    queryFn: () => AccommodationsService.listAccommodations({ popupId }),
    enabled: !!popupId,
  })
}

/**
 * The gathering's default minimum stay, which a room type may override.
 *
 * Fetched rather than passed down: the dialog opens from two places and this
 * keeps both callers from having to know the rule exists.
 */
function usePopupMinStay(popupId: string) {
  const { data } = useQuery({
    queryKey: ["popup", popupId],
    queryFn: () => PopupsService.getPopup({ popupId }),
    enabled: !!popupId,
  })
  return data?.accommodation_min_stay ?? null
}

/**
 * The refusal, shown where the operator is already looking.
 *
 * It names the override by its label, because the switch below is the
 * intended way out for a comp or a phone booking and an operator should not
 * have to guess that.
 */
function StayProblemAlert({
  title,
  detail,
}: {
  title: string
  detail: string
}) {
  return (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <span>{detail}</span>
        <span>
          To book it anyway, turn on <strong>Ignore booking rules</strong>{" "}
          below.
        </span>
      </AlertDescription>
    </Alert>
  )
}

function RoomSelect({
  rooms,
  value,
  onChange,
}: {
  rooms: AccommodationPublic[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="booking-room">Room type</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="booking-room">
          <SelectValue placeholder="Pick a room type" />
        </SelectTrigger>
        <SelectContent>
          {rooms.map((room) => (
            <SelectItem key={room.id} value={room.id}>
              {room.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function DateRangeFields({
  checkIn,
  checkOut,
  onCheckIn,
  onCheckOut,
}: {
  checkIn: string
  checkOut: string
  onCheckIn: (value: string) => void
  onCheckOut: (value: string) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="booking-check-in">Check-in</Label>
        <DatePicker
          id="booking-check-in"
          value={checkIn}
          onChange={onCheckIn}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="booking-check-out">Check-out</Label>
        <DatePicker
          id="booking-check-out"
          value={checkOut}
          onChange={onCheckOut}
          // Check-out night is not slept in, so the earliest valid check-out
          // is the day after arrival.
          disabledDays={(day) =>
            !!checkIn && day <= new Date(`${checkIn}T12:00:00`)
          }
        />
      </div>
    </div>
  )
}

export function NewBookingDialog({
  popupId,
  open,
  onOpenChange,
  prefill,
}: {
  popupId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  prefill?: Prefill
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { data: rooms } = useRooms(popupId)

  const [accommodationId, setAccommodationId] = useState(
    prefill?.accommodationId ?? "",
  )
  const [unitId, setUnitId] = useState(prefill?.unitId ?? ANY_UNIT)
  const [checkIn, setCheckIn] = useState(prefill?.checkIn ?? todayKey())
  const [checkOut, setCheckOut] = useState(
    addDays(prefill?.checkIn ?? todayKey(), 1),
  )
  const [guestName, setGuestName] = useState("")
  const [guestEmail, setGuestEmail] = useState("")
  const [guestCount, setGuestCount] = useState("1")
  const [notes, setNotes] = useState("")
  const [ignoreRestrictions, setIgnoreRestrictions] = useState(false)

  const room = rooms?.results.find((item) => item.id === accommodationId)
  const units = room?.units ?? []
  const popupMinStay = usePopupMinStay(popupId)

  // Only meaningful once a room type is picked: the rules belong to it. With
  // the override on there is nothing to report, because nothing is enforced.
  const problem =
    room && !ignoreRestrictions
      ? checkStay(
          room,
          { checkIn, checkOut, guests: Number(guestCount) || 1 },
          popupMinStay,
        )
      : null
  const blocks = (field: StayProblemField) => problem?.field === field

  const create = useMutation({
    mutationFn: () =>
      AccommodationsService.createManualBooking({
        requestBody: {
          popup_id: popupId,
          accommodation_id: accommodationId,
          unit_id: unitId === ANY_UNIT ? null : unitId,
          kind: "guest",
          check_in: checkIn,
          check_out: checkOut,
          guest_count: Number(guestCount) || 1,
          primary_guest_name: guestName.trim() || null,
          primary_guest_email: guestEmail.trim() || null,
          notes: notes.trim() || null,
          ignore_restrictions: ignoreRestrictions,
        },
      }),
    onSuccess: () => {
      showSuccessToast("Booking created")
      queryClient.invalidateQueries({ queryKey: ["accommodations"] })
      onOpenChange(false)
    },
    // A 409 here means every unit of that type is taken for those dates; the
    // server says that better than a generic failure would.
    onError: createErrorHandler(showErrorToast),
  })

  const canSubmit =
    !!accommodationId && !!checkIn && checkOut > checkIn && !problem

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New booking</DialogTitle>
          <DialogDescription>
            A comp, a phone reservation, an organiser room. Confirmed
            immediately. No payment is expected.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <RoomSelect
            rooms={rooms?.results ?? []}
            value={accommodationId}
            onChange={(value) => {
              setAccommodationId(value)
              setUnitId(ANY_UNIT)
            }}
          />

          {problem && blocks("room") && <StayProblemAlert {...problem} />}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="booking-unit">Unit</Label>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger id="booking-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_UNIT}>Any free unit</SelectItem>
                {units.map((unit) => (
                  <SelectItem key={unit.id} value={unit.id}>
                    {unit.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Leave this on any free unit unless the guest was promised a
              specific room. The backend picks the unit that wastes the least
              space.
            </p>
          </div>

          <DateRangeFields
            checkIn={checkIn}
            checkOut={checkOut}
            onCheckIn={(value) => {
              setCheckIn(value)
              if (checkOut <= value) setCheckOut(addDays(value, 1))
            }}
            onCheckOut={setCheckOut}
          />

          {problem && blocks("dates") && <StayProblemAlert {...problem} />}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="booking-guest-name">Guest name</Label>
              <Input
                id="booking-guest-name"
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="booking-guest-email">Guest email</Label>
              <Input
                id="booking-guest-email"
                type="email"
                value={guestEmail}
                onChange={(event) => setGuestEmail(event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="booking-guest-count">Guests</Label>
            <Input
              id="booking-guest-count"
              className="w-24"
              type="number"
              min="1"
              value={guestCount}
              aria-invalid={blocks("guests")}
              onChange={(event) => setGuestCount(event.target.value)}
            />
            {problem && blocks("guests") && <StayProblemAlert {...problem} />}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="booking-notes">Notes</Label>
            <Textarea
              id="booking-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Visible to staff and to the property owner in the export."
            />
          </div>

          <div
            className={cn(
              "flex items-start justify-between gap-4 rounded-lg border p-3",
              problem && "border-destructive/40 bg-destructive/5",
            )}
          >
            <div>
              <Label htmlFor="booking-ignore">Ignore booking rules</Label>
              <p className="text-xs text-muted-foreground">
                Book outside the bookable window, below the minimum stay, or
                over the room's capacity.
              </p>
            </div>
            <Switch
              id="booking-ignore"
              checked={ignoreRestrictions}
              onCheckedChange={setIgnoreRestrictions}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <LoadingButton
            loading={create.isPending}
            disabled={!canSubmit}
            onClick={() => create.mutate()}
          >
            Create booking
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function BlockDatesDialog({
  popupId,
  open,
  onOpenChange,
  prefill,
}: {
  popupId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  prefill?: Prefill
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { data: rooms } = useRooms(popupId)

  const [accommodationId, setAccommodationId] = useState(
    prefill?.accommodationId ?? "",
  )
  const [checkIn, setCheckIn] = useState(prefill?.checkIn ?? todayKey())
  const [checkOut, setCheckOut] = useState(
    addDays(prefill?.checkIn ?? todayKey(), 1),
  )
  const [kind, setKind] = useState<BookingKind>("block")
  const [notes, setNotes] = useState("")

  const block = useMutation({
    mutationFn: () =>
      AccommodationsService.blockRange({
        requestBody: {
          popup_id: popupId,
          accommodation_id: accommodationId,
          check_in: checkIn,
          check_out: checkOut,
          kind,
          notes: notes.trim() || null,
        },
      }),
    onSuccess: (result) => {
      showSuccessToast(
        result.skipped > 0
          ? `${result.created} unit${
              result.created === 1 ? "" : "s"
            } blocked, ${result.skipped} left alone, already booked`
          : `${result.created} unit${result.created === 1 ? "" : "s"} blocked`,
      )
      queryClient.invalidateQueries({ queryKey: ["accommodations"] })
      onOpenChange(false)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const canSubmit = !!accommodationId && !!checkIn && checkOut > checkIn

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Block dates</DialogTitle>
          <DialogDescription>
            Takes every unit of a room type off the market for a range. Units
            that already have a guest are left alone, not overwritten.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <RoomSelect
            rooms={rooms?.results ?? []}
            value={accommodationId}
            onChange={setAccommodationId}
          />

          <DateRangeFields
            checkIn={checkIn}
            checkOut={checkOut}
            onCheckIn={(value) => {
              setCheckIn(value)
              if (checkOut <= value) setCheckOut(addDays(value, 1))
            }}
            onCheckOut={setCheckOut}
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="block-kind">Reason</Label>
            <Select
              value={kind}
              onValueChange={(value) => setKind(value as BookingKind)}
            >
              <SelectTrigger id="block-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="block">Held back</SelectItem>
                <SelectItem value="maintenance">Maintenance</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="block-notes">Notes</Label>
            <Textarea
              id="block-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Shown on the calendar bar."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <LoadingButton
            loading={block.isPending}
            disabled={!canSubmit}
            onClick={() => block.mutate()}
          >
            Block
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
