import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { CalendarPlus, Download } from "lucide-react"
import { useMemo, useState } from "react"

import {
  type AccommodationBookingPublic,
  AccommodationsService,
  type BookingStatus,
} from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import useCustomToast from "@/hooks/useCustomToast"
import { cn } from "@/lib/utils"
import { bookingAppearance } from "./bookingAppearance"
import {
  type BookingDetail,
  BookingDetailDialog,
  detailFromRow,
} from "./BookingDetailDialog"
import { NewBookingDialog } from "./BookingDialog"
import { addDays, monthWindow, todayKey } from "./calendarLayout"
import { downloadBookingsCsv } from "./exportBookings"

/**
 * The same bookings the calendar draws, as a list.
 *
 * The calendar answers "is this room free"; this answers "who is arriving on
 * Thursday, and did they pay". It is also the surface that shows released
 * stays: cancelled and expired holds are invisible on the calendar by
 * design, and an operator chasing a refund still needs to find them.
 */

const ALL = "all"
const STATUS_OPTIONS: { value: BookingStatus; label: string }[] = [
  { value: "confirmed", label: "Confirmed" },
  { value: "hold", label: "On hold" },
  { value: "cancelled", label: "Cancelled" },
  { value: "expired", label: "Expired" },
]

export function BookingsTab({ popupId }: { popupId: string }) {
  const { showErrorToast } = useCustomToast()

  const [dateFrom, setDateFrom] = useState(() => monthWindow(todayKey()).from)
  const [dateTo, setDateTo] = useState(() => addDays(todayKey(), 180))
  const [propertyId, setPropertyId] = useState(ALL)
  const [status, setStatus] = useState<BookingStatus | typeof ALL>(ALL)
  const [search, setSearch] = useState("")
  const [detail, setDetail] = useState<BookingDetail | null>(null)
  const [creating, setCreating] = useState(false)

  const statuses = status === ALL ? null : [status]
  // Declared here rather than inline: the query and the message the operator
  // reads have to agree on what an unusable window is.
  const rangeInvalid = dateTo <= dateFrom

  const { data: properties } = useQuery({
    queryKey: ["accommodations", "properties", popupId],
    queryFn: () => AccommodationsService.listProperties({ popupId }),
    enabled: !!popupId,
  })

  const { data: rooms } = useQuery({
    queryKey: ["accommodations", "rooms", popupId],
    queryFn: () => AccommodationsService.listAccommodations({ popupId }),
    enabled: !!popupId,
  })

  const { data: bookings } = useQuery({
    queryKey: [
      "accommodations",
      "bookings",
      popupId,
      dateFrom,
      dateTo,
      propertyId,
      status,
      search,
    ],
    queryFn: () =>
      AccommodationsService.listBookings({
        popupId,
        dateFrom,
        dateTo,
        propertyId: propertyId === ALL ? undefined : propertyId,
        statuses: statuses ?? undefined,
        search: search.trim() || undefined,
      }),
    enabled: !!popupId && !rangeInvalid,
  })

  // Room types carry their units, which the detail dialog needs to offer a
  // reassignment without a second round-trip per row.
  const roomsById = useMemo(
    () => new Map((rooms?.results ?? []).map((room) => [room.id, room])),
    [rooms],
  )

  const selectedRoom = detail
    ? roomsById.get(detail.accommodationId)
    : undefined

  const exportCsv = async () => {
    try {
      await downloadBookingsCsv({
        popupId,
        dateFrom,
        dateTo,
        propertyId: propertyId === ALL ? null : propertyId,
        statuses,
        search,
      })
    } catch {
      showErrorToast("The export could not be generated")
    }
  }

  const columns: ColumnDef<AccommodationBookingPublic>[] = [
    {
      accessorKey: "primary_guest_name",
      header: "Guest",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">
            {row.original.kind === "guest"
              ? row.original.primary_guest_name || "Guest"
              : (row.original.notes ?? "Blocked")}
          </span>
          {row.original.primary_guest_email && (
            <span className="text-xs text-muted-foreground">
              {row.original.primary_guest_email}
            </span>
          )}
        </div>
      ),
    },
    {
      id: "room",
      header: "Room",
      cell: ({ row }) => {
        const room = roomsById.get(row.original.accommodation_id)
        const unit = room?.units?.find(
          (item) => item.id === row.original.unit_id,
        )
        return (
          <span className="text-muted-foreground">
            {room?.name ?? "—"}
            {unit ? ` · ${unit.label}` : ""}
          </span>
        )
      },
    },
    {
      accessorKey: "check_in",
      header: "Stay",
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.check_in} → {row.original.check_out}
        </span>
      ),
    },
    {
      accessorKey: "nights",
      header: "Nights",
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.nights ?? "—"}</span>
      ),
    },
    {
      accessorKey: "guest_count",
      header: "Guests",
      cell: ({ row }) => row.original.guest_count ?? "—",
    },
    {
      id: "total",
      header: "Total",
      cell: ({ row }) => {
        const snapshot = row.original.price_snapshot as {
          total?: unknown
        } | null
        return (
          <span className="tabular-nums">
            {snapshot?.total == null ? "—" : String(snapshot.total)}
          </span>
        )
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const appearance = bookingAppearance(row.original)
        return (
          <Badge className={cn("font-normal", appearance.className)}>
            {appearance.label}
          </Badge>
        )
      },
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bookings-from">From</Label>
          <DatePicker
            id="bookings-from"
            className="w-40"
            value={dateFrom}
            onChange={setDateFrom}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bookings-to">To</Label>
          <DatePicker
            id="bookings-to"
            className="w-40"
            value={dateTo}
            onChange={setDateTo}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bookings-property">Property</Label>
          <Select value={propertyId} onValueChange={setPropertyId}>
            <SelectTrigger id="bookings-property" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All properties</SelectItem>
              {(properties?.results ?? []).map((property) => (
                <SelectItem key={property.id} value={property.id}>
                  {property.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bookings-status">Status</Label>
          <Select
            value={status}
            onValueChange={(value) =>
              setStatus(value as BookingStatus | typeof ALL)
            }
          >
            <SelectTrigger id="bookings-status" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any status</SelectItem>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <CalendarPlus className="mr-2 h-4 w-4" />
            New booking
          </Button>
        </div>
      </div>

      {rangeInvalid ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          The end of the window has to come after its start.
        </p>
      ) : !bookings ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <DataTable
          columns={columns}
          data={bookings.results}
          tableId="accommodation-bookings"
          searchPlaceholder="Guest name, email or notes"
          searchValue={search}
          onSearchChange={setSearch}
          hiddenOnMobile={["guest_count", "nights", "total"]}
          onRowClick={(booking) => setDetail(detailFromRow(booking))}
          emptyState={
            <EmptyState
              icon={CalendarPlus}
              title="No bookings in this window"
              description="Stays sold through the checkout land here, together with anything staff books by hand."
            />
          }
        />
      )}

      <BookingDetailDialog
        booking={detail}
        roomName={selectedRoom?.name ?? ""}
        units={(selectedRoom?.units ?? []).map((unit) => ({
          id: unit.id,
          label: unit.label,
        }))}
        open={!!detail}
        onOpenChange={(open) => !open && setDetail(null)}
      />

      {creating && (
        <NewBookingDialog
          popupId={popupId}
          open
          onOpenChange={(open) => !open && setCreating(open)}
        />
      )}
    </div>
  )
}
