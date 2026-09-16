import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { BedDouble, CalendarRange, DollarSign, Eye, Home } from "lucide-react"
import { useState } from "react"

import {
  type AccommodationKind,
  type AccommodationPublic,
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
import { DatePicker } from "@/components/ui/date-picker"
import { InlineRow, InlineSection } from "@/components/ui/inline-form"
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
import { createErrorHandler } from "@/utils"
import { BedsEditor } from "./BedsEditor"
import { type BedSpec, parseBeds, sleepsFromBeds } from "./beds"
import { PhotoLibraryPicker } from "./PhotoLibraryPicker"
import { PriceRulesEditor } from "./PriceRulesEditor"
import { UnitsEditor } from "./UnitsEditor"

const KINDS: { value: AccommodationKind; label: string }[] = [
  { value: "room", label: "Room" },
  { value: "apartment", label: "Apartment" },
  { value: "studio", label: "Studio" },
  { value: "cabin", label: "Cabin" },
  { value: "tent", label: "Tent" },
  { value: "other", label: "Other" },
]

interface AccommodationFormProps {
  popupId: string
  defaultValues?: AccommodationPublic
  onSuccess: () => void
}

/**
 * The room-type editor.
 *
 * Everything that decides what a stay costs and when it can be booked lives
 * here; the checkout only decides which of these are *offered*. Units and
 * price rules are edited against the saved row (they are separate endpoints),
 * so they appear disabled until the room exists.
 */
export function AccommodationForm({
  popupId,
  defaultValues,
  onSuccess,
}: AccommodationFormProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const isEdit = Boolean(defaultValues)

  const [name, setName] = useState(defaultValues?.name ?? "")
  const [propertyId, setPropertyId] = useState(defaultValues?.property_id ?? "")
  const [kind, setKind] = useState(defaultValues?.kind ?? "room")
  const [description, setDescription] = useState(
    defaultValues?.description ?? "",
  )
  const [beds, setBeds] = useState<BedSpec[]>(parseBeds(defaultValues?.beds))
  const [guestCapacity, setGuestCapacity] = useState(
    defaultValues?.guest_capacity?.toString() ?? "2",
  )
  const [nightly, setNightly] = useState(
    defaultValues?.default_nightly_price?.toString() ?? "",
  )
  const [longStay, setLongStay] = useState(
    defaultValues?.long_stay_price?.toString() ?? "",
  )
  const [minStay, setMinStay] = useState(
    defaultValues?.min_stay_override?.toString() ?? "",
  )
  const [bookableFrom, setBookableFrom] = useState(
    defaultValues?.bookable_from ?? "",
  )
  const [bookableTo, setBookableTo] = useState(defaultValues?.bookable_to ?? "")
  const [visible, setVisible] = useState(
    defaultValues?.visible_in_checkout ?? true,
  )
  const [isActive, setIsActive] = useState(defaultValues?.is_active ?? true)
  const [imageIds, setImageIds] = useState<string[]>(
    (defaultValues?.images ?? []).map((image) => image.id),
  )
  const [unitsCount, setUnitsCount] = useState("2")

  const { data: properties } = useQuery({
    queryKey: ["accommodations", "properties", popupId],
    queryFn: () => AccommodationsService.listProperties({ popupId }),
    enabled: !!popupId,
  })

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        property_id: propertyId,
        kind,
        description: description.trim() || null,
        beds,
        guest_capacity: Number(guestCapacity) || 1,
        default_nightly_price: nightly,
        long_stay_price: longStay.trim() ? longStay.trim() : null,
        min_stay_override: minStay.trim() ? Number(minStay) : null,
        bookable_from: bookableFrom,
        bookable_to: bookableTo,
        visible_in_checkout: visible,
        is_active: isActive,
        image_ids: imageIds,
      }

      if (defaultValues) {
        return AccommodationsService.updateAccommodation({
          accommodationId: defaultValues.id,
          requestBody: body,
        })
      }
      return AccommodationsService.createAccommodation({
        requestBody: {
          ...body,
          popup_id: popupId,
          units_count: Number(unitsCount) || undefined,
        },
      })
    },
    onSuccess: (saved) => {
      showSuccessToast(isEdit ? "Room saved" : "Room created")
      queryClient.invalidateQueries({ queryKey: ["accommodations"] })
      if (isEdit) {
        onSuccess()
      } else {
        // Land on the editor: units and price rules can only be attached to a
        // saved room, so sending the operator back to the list would hide the
        // half of the job that is still undone.
        navigate({
          to: "/accommodations/rooms/$id/edit",
          params: { id: saved.id },
        })
      }
    },
    onError: createErrorHandler(showErrorToast),
  })

  const bedsSleep = sleepsFromBeds(beds)
  const capacityBeyondBeds = bedsSleep > 0 && Number(guestCapacity) > bedsSleep

  const canSave = Boolean(
    name.trim() && propertyId && nightly.trim() && bookableFrom && bookableTo,
  )

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Home className="h-4 w-4" />
            Basics
          </CardTitle>
          <CardDescription>
            What this room type is, and where it lives.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="room-name">Name</Label>
              <Input
                id="room-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Double Room"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="room-property">Property</Label>
              <Select value={propertyId} onValueChange={setPropertyId}>
                <SelectTrigger id="room-property">
                  <SelectValue placeholder="Pick a property" />
                </SelectTrigger>
                <SelectContent>
                  {(properties?.results ?? []).map((property) => (
                    <SelectItem key={property.id} value={property.id}>
                      {property.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="room-kind">Kind</Label>
              <Select
                value={kind}
                onValueChange={(value) => setKind(value as AccommodationKind)}
              >
                <SelectTrigger id="room-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="room-capacity">Sleeps</Label>
              <Input
                id="room-capacity"
                type="number"
                min="1"
                max="100"
                value={guestCapacity}
                onChange={(event) => setGuestCapacity(event.target.value)}
              />
              {capacityBeyondBeds && (
                <p className="text-xs text-warning-foreground">
                  The beds below sleep {bedsSleep}. Guests over that will be
                  accepted at checkout, so make sure that is intentional.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Beds</Label>
            <BedsEditor value={beds} onChange={setBeds} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="room-description">Description</Label>
            <Textarea
              id="room-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Lake-facing room with a private bathroom."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DollarSign className="h-4 w-4" />
            Pricing and availability
          </CardTitle>
          <CardDescription>
            What a night costs, and when this room can be booked.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="room-nightly">Nightly price</Label>
              <Input
                id="room-nightly"
                type="number"
                min="0"
                step="0.01"
                value={nightly}
                onChange={(event) => setNightly(event.target.value)}
                placeholder="120.00"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="room-long-stay">Monthly rate (per night)</Label>
              <Input
                id="room-long-stay"
                type="number"
                min="0"
                step="0.01"
                value={longStay}
                onChange={(event) => setLongStay(event.target.value)}
                placeholder="Leave empty for none"
              />
              <p className="text-xs text-muted-foreground">
                Applies when the stay covers a whole month, and replaces every
                date-range rule for those nights.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Bookable from</Label>
              <DatePicker value={bookableFrom} onChange={setBookableFrom} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Bookable to</Label>
              <DatePicker value={bookableTo} onChange={setBookableTo} />
              <p className="text-xs text-muted-foreground">
                Independent of the gathering's dates: the last check-out
                allowed.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="room-min-stay">Minimum stay (nights)</Label>
              <Input
                id="room-min-stay"
                type="number"
                min="1"
                value={minStay}
                onChange={(event) => setMinStay(event.target.value)}
                placeholder="Uses the gathering default"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <CalendarRange className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Date-range prices</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              A weekend, a high season and a promo are all the same thing here:
              a range with its own nightly price.
            </p>
            <PriceRulesEditor accommodationId={defaultValues?.id ?? null} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BedDouble className="h-4 w-4" />
            Units
          </CardTitle>
          <CardDescription>
            The physical rooms behind this type. A booking occupies one of them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isEdit ? (
            <UnitsEditor
              accommodationId={defaultValues?.id ?? null}
              units={defaultValues?.units ?? []}
            />
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="room-units">Create this many units</Label>
                <Input
                  id="room-units"
                  className="w-28"
                  type="number"
                  min="0"
                  max="500"
                  value={unitsCount}
                  onChange={(event) => setUnitsCount(event.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                You can add, rename or deactivate them after saving.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Photos</CardTitle>
          <CardDescription>
            Pick from this gathering's photo library.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PhotoLibraryPicker
            popupId={popupId}
            value={imageIds}
            onChange={setImageIds}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Eye className="h-4 w-4" />
            Visibility
          </CardTitle>
        </CardHeader>
        <CardContent>
          <InlineSection>
            <InlineRow
              label="Show in checkout"
              description="Hide a room to keep it bookable by staff only."
            >
              <Switch checked={visible} onCheckedChange={setVisible} />
            </InlineRow>
            <InlineRow
              label="Active"
              description="Inactive rooms stop being sold. Existing bookings are untouched."
            >
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </InlineRow>
          </InlineSection>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onSuccess}>
          Cancel
        </Button>
        <LoadingButton
          loading={save.isPending}
          disabled={!canSave}
          onClick={() => save.mutate()}
        >
          {isEdit ? "Save changes" : "Create room"}
        </LoadingButton>
      </div>
    </div>
  )
}
