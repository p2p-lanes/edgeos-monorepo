import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Building2, Eye, Percent, UserRound } from "lucide-react"
import { useState } from "react"

import {
  type AccommodationPropertyPublic,
  AccommodationsService,
} from "@/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { InlineRow, InlineSection } from "@/components/ui/inline-form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

interface PropertyFormProps {
  popupId: string
  defaultValues?: AccommodationPropertyPublic
  onSuccess: () => void
}

/**
 * The property editor: the building or site a room belongs to.
 *
 * A property carries three things a room does not: who the operator calls
 * when something goes wrong, the lodging tax that is itemised in every quote
 * for its rooms, and whether any of it is on sale at all.
 */
export function PropertyForm({
  popupId,
  defaultValues,
  onSuccess,
}: PropertyFormProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const isEdit = Boolean(defaultValues)

  const [name, setName] = useState(defaultValues?.name ?? "")
  const [address, setAddress] = useState(defaultValues?.address ?? "")
  const [description, setDescription] = useState(
    defaultValues?.description ?? "",
  )
  const [contactName, setContactName] = useState(
    defaultValues?.contact_name ?? "",
  )
  const [contactEmail, setContactEmail] = useState(
    defaultValues?.contact_email ?? "",
  )
  const [taxPercentage, setTaxPercentage] = useState(
    defaultValues?.tax_percentage?.toString() ?? "",
  )
  const [isActive, setIsActive] = useState(defaultValues?.is_active ?? true)
  const [sortOrder, setSortOrder] = useState(
    defaultValues?.sort_order?.toString() ?? "0",
  )

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        address: address.trim() || null,
        description: description.trim() || null,
        contact_name: contactName.trim() || null,
        contact_email: contactEmail.trim() || null,
        // Empty means "no tax line at all", which is not the same as 0%.
        tax_percentage: taxPercentage.trim() ? taxPercentage.trim() : null,
        is_active: isActive,
        sort_order: Number(sortOrder) || 0,
      }

      if (defaultValues) {
        return AccommodationsService.updateProperty({
          propertyId: defaultValues.id,
          requestBody: body,
        })
      }
      return AccommodationsService.createProperty({
        requestBody: { ...body, popup_id: popupId },
      })
    },
    onSuccess: () => {
      showSuccessToast(isEdit ? "Property saved" : "Property created")
      queryClient.invalidateQueries({ queryKey: ["accommodations"] })
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            Basics
          </CardTitle>
          <CardDescription>
            What this property is, and where guests are going.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
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
              <Input
                id="property-address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="12 Lake Road, Buenos Aires"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="property-description">Description</Label>
            <Textarea
              id="property-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="A restored 1920s house two blocks from the lake."
            />
            <p className="text-xs text-muted-foreground">
              Shown to buyers above the rooms of this property in the checkout.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserRound className="h-4 w-4" />
            Contact
          </CardTitle>
          <CardDescription>
            Who to call about a booking here. Internal: buyers never see this.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="property-contact-name">Contact name</Label>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Percent className="h-4 w-4" />
            Lodging tax
          </CardTitle>
          <CardDescription>
            Applied on top of the nightly subtotal for every room of this
            property.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-1.5 sm:max-w-xs">
            <Label htmlFor="property-tax">Tax (%)</Label>
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
              Shown as its own line in the quote. Leave empty when the nightly
              price already includes it: empty is not the same as 0%, which
              prints a zero tax line.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Eye className="h-4 w-4" />
            Visibility
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <InlineSection>
            <InlineRow
              label="Active"
              description="Inactive properties stay on the calendar but stop being offered. Existing bookings are untouched."
            >
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </InlineRow>
          </InlineSection>

          <div className="flex flex-col gap-1.5 sm:max-w-xs">
            <Label htmlFor="property-sort-order">Sort order</Label>
            <Input
              id="property-sort-order"
              type="number"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Lower comes first in the checkout. Ties fall back to the name.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onSuccess}>
          Cancel
        </Button>
        <LoadingButton
          loading={save.isPending}
          disabled={!name.trim()}
          onClick={() => save.mutate()}
        >
          {isEdit ? "Save changes" : "Create property"}
        </LoadingButton>
      </div>
    </div>
  )
}
