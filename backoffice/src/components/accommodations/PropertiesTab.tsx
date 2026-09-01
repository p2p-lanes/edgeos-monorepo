import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { Building2, EllipsisVertical, Plus } from "lucide-react"
import { useState } from "react"

import {
  type AccommodationPropertyPublic,
  AccommodationsService,
} from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

/**
 * Properties are the buildings that hold rooms: a hotel, a camp, a house.
 * They carry the contact the operator calls and the optional lodging tax that
 * is itemised in every quote for their rooms.
 */

interface PropertyDialogProps {
  popupId: string
  property: AccommodationPropertyPublic | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function PropertyDialog({
  popupId,
  property,
  open,
  onOpenChange,
}: PropertyDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [name, setName] = useState(property?.name ?? "")
  const [address, setAddress] = useState(property?.address ?? "")
  const [contactName, setContactName] = useState(property?.contact_name ?? "")
  const [contactEmail, setContactEmail] = useState(
    property?.contact_email ?? "",
  )
  const [taxPercentage, setTaxPercentage] = useState(
    property?.tax_percentage?.toString() ?? "",
  )
  const [isActive, setIsActive] = useState(property?.is_active ?? true)

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        address: address.trim() || null,
        contact_name: contactName.trim() || null,
        contact_email: contactEmail.trim() || null,
        // Empty means "no tax line at all", which is not the same as 0%.
        tax_percentage: taxPercentage.trim() ? taxPercentage.trim() : null,
        is_active: isActive,
      }
      if (property) {
        return AccommodationsService.updateProperty({
          propertyId: property.id,
          requestBody: body,
        })
      }
      return AccommodationsService.createProperty({
        requestBody: { ...body, popup_id: popupId },
      })
    },
    onSuccess: () => {
      showSuccessToast(property ? "Property updated" : "Property created")
      queryClient.invalidateQueries({ queryKey: ["accommodations"] })
      onOpenChange(false)
    },
    onError: createErrorHandler(showErrorToast),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {property ? "Edit property" : "New property"}
          </DialogTitle>
          <DialogDescription>
            A building or site that holds rooms.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="property-name">Name</Label>
            <Input
              id="property-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Hotel Arcadia"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="property-address">Address</Label>
            <Textarea
              id="property-address"
              rows={2}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="12 Lake Road, Buenos Aires"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="property-contact-name">Contact</Label>
              <Input
                id="property-contact-name"
                value={contactName}
                onChange={(event) => setContactName(event.target.value)}
                placeholder="Marta"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="property-contact-email">Contact email</Label>
              <Input
                id="property-contact-email"
                type="email"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                placeholder="owner@example.com"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="property-tax">Lodging tax (%)</Label>
            <Input
              id="property-tax"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={taxPercentage}
              onChange={(event) => setTaxPercentage(event.target.value)}
              placeholder="Leave empty for no tax"
            />
            <p className="text-xs text-muted-foreground">
              Added on top of the nightly subtotal and shown as its own line in
              the checkout. Leave empty when the price already includes it.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label className="text-sm font-medium">Active</Label>
              <p className="text-xs text-muted-foreground">
                Inactive properties stay on the calendar but stop being offered.
              </p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <LoadingButton
            loading={mutation.isPending}
            disabled={!name.trim()}
            onClick={() => mutation.mutate()}
          >
            {property ? "Save" : "Create"}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PropertyActions({
  property,
  onEdit,
}: {
  property: AccommodationPropertyPublic
  onEdit: () => void
}) {
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
        <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
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
  const [editing, setEditing] = useState<AccommodationPropertyPublic | null>(
    null,
  )
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data } = useQuery({
    queryKey: ["accommodations", "properties", popupId],
    queryFn: () => AccommodationsService.listProperties({ popupId }),
    enabled: !!popupId,
  })

  const openNew = () => {
    setEditing(null)
    setDialogOpen(true)
  }

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
          <PropertyActions
            property={row.original}
            onEdit={() => {
              setEditing(row.original)
              setDialogOpen(true)
            }}
          />
        </div>
      ),
    },
  ]

  if (!data) return <Skeleton className="h-64 w-full" />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={openNew}>
          <Plus className="mr-2 h-4 w-4" />
          Add property
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data.results}
        tableId="accommodation-properties"
        emptyState={
          <EmptyState
            icon={Building2}
            title="No properties yet"
            description="A property is the building or site your rooms belong to. Add one to start."
            action={
              <Button onClick={openNew}>
                <Plus className="mr-2 h-4 w-4" />
                Add property
              </Button>
            }
          />
        }
      />

      {dialogOpen && (
        <PropertyDialog
          key={editing?.id ?? "new"}
          popupId={popupId}
          property={editing}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}
    </div>
  )
}
