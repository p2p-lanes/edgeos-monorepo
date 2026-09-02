import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { BedDouble, Copy, EllipsisVertical, Plus } from "lucide-react"

import { type AccommodationPublic, AccommodationsService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import useCustomToast from "@/hooks/useCustomToast"
import { cn } from "@/lib/utils"
import { createErrorHandler } from "@/utils"
import { describeBeds } from "./beds"
import { RoomsBulkActions } from "./RoomsBulkActions"

/**
 * Room *types*, not rooms. One row here is "Double Room", backed by however
 * many interchangeable units the property has. That split is what makes 50
 * identical rooms one checkout option instead of fifty.
 */

function RoomActions({ room }: { room: AccommodationPublic }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const duplicate = useMutation({
    mutationFn: () =>
      AccommodationsService.duplicateAccommodation({
        accommodationId: room.id,
        requestBody: { copy_units: true, copy_price_rules: true },
      }),
    onSuccess: (copy) => {
      showSuccessToast("Room duplicated")
      queryClient.invalidateQueries({ queryKey: ["accommodations"] })
      navigate({
        to: "/accommodations/rooms/$id/edit",
        params: { id: copy.id },
      })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const retire = useMutation({
    mutationFn: () =>
      AccommodationsService.deleteAccommodation({ accommodationId: room.id }),
    onSuccess: () => {
      showSuccessToast("Room retired")
      queryClient.invalidateQueries({ queryKey: ["accommodations"] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Room actions">
          <EllipsisVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={duplicate.isPending}
          onSelect={() => duplicate.mutate()}
        >
          <Copy className="mr-2 h-4 w-4" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={retire.isPending}
          onSelect={() => retire.mutate()}
        >
          Retire
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function RoomsTab({ popupId }: { popupId: string }) {
  const navigate = useNavigate()

  const { data: rooms } = useQuery({
    queryKey: ["accommodations", "rooms", popupId],
    queryFn: () => AccommodationsService.listAccommodations({ popupId }),
    enabled: !!popupId,
  })

  const { data: properties } = useQuery({
    queryKey: ["accommodations", "properties", popupId],
    queryFn: () => AccommodationsService.listProperties({ popupId }),
    enabled: !!popupId,
  })

  const propertyNames = new Map(
    (properties?.results ?? []).map((property) => [property.id, property.name]),
  )

  const columns: ColumnDef<AccommodationPublic>[] = [
    {
      accessorKey: "name",
      header: "Room type",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span
            role="img"
            aria-label={row.original.is_active ? "Active" : "Inactive"}
            title={row.original.is_active ? "Active" : "Inactive"}
            className={cn(
              "size-2 shrink-0 rounded-full",
              row.original.is_active ? "bg-success" : "bg-destructive",
            )}
          />
          <span className="font-medium">{row.original.name}</span>
          {!row.original.visible_in_checkout && (
            <Badge variant="secondary">Hidden</Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: "property_id",
      header: "Property",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {propertyNames.get(row.original.property_id) ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "beds",
      header: "Beds",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {describeBeds(row.original.beds) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "guest_capacity",
      header: "Sleeps",
      cell: ({ row }) => row.original.guest_capacity,
    },
    {
      id: "units",
      header: "Units",
      cell: ({ row }) => row.original.units?.length ?? 0,
    },
    {
      accessorKey: "default_nightly_price",
      header: "Nightly",
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.default_nightly_price}
        </span>
      ),
    },
    {
      id: "bookable",
      header: "Bookable",
      cell: ({ row }) => (
        <span className="text-muted-foreground tabular-nums">
          {row.original.bookable_from} → {row.original.bookable_to}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      meta: { toggleable: false },
      cell: ({ row }) => (
        <div className="flex justify-end">
          <RoomActions room={row.original} />
        </div>
      ),
    },
  ]

  if (!rooms) return <Skeleton className="h-64 w-full" />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button asChild>
          <Link to="/accommodations/rooms/new">
            <Plus className="mr-2 h-4 w-4" />
            Add room type
          </Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={rooms.results}
        tableId="accommodation-rooms"
        selectable
        bulkActions={(selected) => <RoomsBulkActions selected={selected} />}
        hiddenOnMobile={["beds", "bookable", "guest_capacity"]}
        onRowClick={(room) =>
          navigate({
            to: "/accommodations/rooms/$id/edit",
            params: { id: room.id },
          })
        }
        emptyState={
          <EmptyState
            icon={BedDouble}
            title="No rooms yet"
            description="A room type is what the checkout sells: one card per type, backed by as many units as the property has."
            action={
              <Button asChild>
                <Link to="/accommodations/rooms/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Add room type
                </Link>
              </Button>
            }
          />
        }
      />
    </div>
  )
}
