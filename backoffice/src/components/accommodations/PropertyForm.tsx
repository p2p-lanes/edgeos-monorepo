import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Building2, ClipboardList, Eye, Percent, UserRound } from "lucide-react"
import { useState } from "react"

import {
  type AccommodationPropertyPublic,
  AccommodationsService,
  TicketingStepsService,
} from "@/client"
import {
  GuestFormEditor,
  type GuestFormMode,
  GuestFormPreview,
  type GuestFormValue,
  isEmpty,
  parseForm,
  toApi,
} from "@/components/accommodations/guest-form"
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
import { cn } from "@/lib/utils"
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
  const [guestFormMode, setGuestFormMode] = useState<GuestFormMode>(
    (defaultValues?.guest_form_mode as GuestFormMode) ?? "inherit",
  )
  const [guestForm, setGuestForm] = useState<GuestFormValue>(() =>
    parseForm(defaultValues?.guest_form),
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
        guest_form_mode: guestFormMode,
        // Only a property that overrides carries a form of its own. Keeping
        // one under "inherit" or "off" would leave a second, invisible answer
        // to "what is asked here" waiting to contradict the first.
        guest_form: guestFormMode === "custom" ? toApi(guestForm) : null,
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4" />
            Guest details
          </CardTitle>
          <CardDescription>
            What the checkout asks about the people staying here, beyond their
            names.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GuestDetailsSection
            popupId={popupId}
            mode={guestFormMode}
            form={guestForm}
            onModeChange={setGuestFormMode}
            onFormChange={setGuestForm}
          />
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

const MODES: { value: GuestFormMode; label: string; hint: string }[] = [
  {
    value: "inherit",
    label: "Ask what the checkout asks",
    hint: "This property uses the questions set on the Accommodation step.",
  },
  {
    value: "custom",
    label: "Ask something different here",
    hint: "These questions replace the step's for bookings at this property.",
  },
  {
    value: "off",
    label: "Ask nothing extra",
    hint: "Only a name per guest, whatever the step asks elsewhere.",
  },
]

interface GuestDetailsSectionProps {
  popupId: string
  mode: GuestFormMode
  form: GuestFormValue
  onModeChange: (mode: GuestFormMode) => void
  onFormChange: (form: GuestFormValue) => void
}

/**
 * Which questions this property asks, of the three ways it can answer that.
 *
 * `inherit` shows what it inherits rather than saying the word: an operator
 * who cannot see the inherited questions has no way to judge whether they
 * are the right ones for this building.
 */
function GuestDetailsSection({
  popupId,
  mode,
  form,
  onModeChange,
  onFormChange,
}: GuestDetailsSectionProps) {
  const { data: steps } = useQuery({
    queryKey: ["ticketing-steps", popupId, "accommodation"],
    queryFn: () => TicketingStepsService.listTicketingSteps({ popupId }),
    enabled: !!popupId && mode === "inherit",
  })

  const accommodationSteps = (steps?.results ?? []).filter(
    (step) => step.template === "accommodation-booking" && step.is_enabled,
  )
  const inherited = parseForm(
    (accommodationSteps[0]?.template_config as Record<string, unknown>)
      ?.guest_form,
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {MODES.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
              mode === option.value
                ? "border-primary bg-primary/5"
                : "hover:bg-accent/40",
            )}
          >
            <input
              type="radio"
              name="guest-form-mode"
              className="mt-1"
              checked={mode === option.value}
              onChange={() => {
                // Carry the inherited questions into the override rather than
                // opening an empty editor: "different" almost always means
                // "the same, plus one".
                if (option.value === "custom" && isEmpty(form)) {
                  onFormChange(inherited)
                }
                onModeChange(option.value)
              }}
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{option.label}</span>
              <span className="text-xs text-muted-foreground">
                {option.hint}
              </span>
            </span>
          </label>
        ))}
      </div>

      {mode === "inherit" &&
        (isEmpty(inherited) ? (
          <p className="text-xs text-muted-foreground">
            The Accommodation step asks nothing extra yet, so neither does this
            property. Set the questions in{" "}
            <Link
              to="/ticketing-steps"
              className="underline underline-offset-4"
            >
              Ticketing Steps
            </Link>
            .
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Inherited from the Accommodation step:
            </p>
            <GuestFormPreview form={inherited} />
          </div>
        ))}

      {mode === "custom" && (
        <GuestFormEditor value={form} onChange={onFormChange} />
      )}
    </div>
  )
}
