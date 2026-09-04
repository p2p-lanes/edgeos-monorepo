import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { Building2, EllipsisVertical, Plus } from "lucide-react"

import {
  type AccommodationPropertyPublic,
  AccommodationsService,
} from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

/**
 * Properties are the buildings that hold rooms: a hotel, a camp, a house.
 * They carry the contact the operator calls and the optional lodging tax that
 * is itemised in every quote for their rooms.
 *
 * Editing happens on its own page, like room types: the property is about to
 * grow the guest-details form, and a field editor with a live preview does
 * not belong in a dialog.
 */

function PropertyActions({
  property,
}: {
  property: AccommodationPropertyPublic
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const deleteMutation = useMutation({
    mutationFn: () =>
      AccommodationsService.deleteProperty({ propertyId: property.id }),
    onSuccess: () => {
      showSuccessToast("Property deleted")
      queryClient.invalidateQueries({ queryKey: ["accommodations"] })
    },
    // A property that still holds rooms comes back as a 409 explaining why;
    // surfacing the server's message beats inventing our own.
    onError: createErrorHandler(showErrorToast),
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Property actions">
          <EllipsisVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() =>
            navigate({
              to: "/accommodations/properties/$id/edit",
              params: { id: property.id },
            })
          }
        >
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={deleteMutation.isPending}
          onSelect={() => deleteMutation.mutate()}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function PropertiesTab({ popupId }: { popupId: string }) {
  const navigate = useNavigate()

  const { data } = useQuery({
    queryKey: ["accommodations", "properties", popupId],
    queryFn: () => AccommodationsService.listProperties({ popupId }),
    enabled: !!popupId,
  })

  const columns: ColumnDef<AccommodationPropertyPublic>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "address",
      header: "Address",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.address ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "contact_email",
      header: "Contact",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.contact_name || row.original.contact_email || "—"}
        </span>
      ),
    },
    {
      accessorKey: "tax_percentage",
      header: "Tax",
      cell: ({ row }) =>
        row.original.tax_percentage ? `${row.original.tax_percentage}%` : "—",
    },
    {
      accessorKey: "is_active",
      header: "Status",
      cell: ({ row }) => (row.original.is_active ? "Active" : "Inactive"),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      meta: { toggleable: false },
      cell: ({ row }) => (
        <div className="flex justify-end">
          <PropertyActions property={row.original} />
        </div>
      ),
    },
  ]

  if (!data) return <Skeleton className="h-64 w-full" />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button asChild>
          <Link to="/accommodations/properties/new">
            <Plus className="mr-2 h-4 w-4" />
            Add property
          </Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data.results}
        tableId="accommodation-properties"
        onRowClick={(property) =>
          navigate({
            to: "/accommodations/properties/$id/edit",
            params: { id: property.id },
          })
        }
        emptyState={
          <EmptyState
            icon={Building2}
            title="No properties yet"
            description="A property is the building or site your rooms belong to. Add one to start."
            action={
              <Button asChild>
                <Link to="/accommodations/properties/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Add property
                </Link>
              </Button>
            }
          />
        }
      />
    </div>
  )
}
