import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import { useMemo, useState } from "react"

import {
  type EventVenueCreate,
  type EventVenuePublic,
  EventVenuesService,
  type EventVenueUpdate,
  type VenueBookingMode,
  type VenueWeeklyHourInput,
} from "@/client"
import { DangerZone } from "@/components/Common/DangerZone"
import { FieldError } from "@/components/Common/FieldError"
import { Button } from "@/components/ui/button"
import { ImageUpload } from "@/components/ui/image-upload"
import {
  HeroInput,
  InlineRow,
  InlineSection,
} from "@/components/ui/inline-form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import {
  UnsavedChangesDialog,
  useUnsavedChanges,
} from "@/hooks/useUnsavedChanges"
import { createErrorHandler } from "@/utils"
import { ChipsWithSuggestions } from "./VenueForm/ChipsWithSuggestions"
import { ExceptionsEditor } from "./VenueForm/ExceptionsEditor"
import { GallerySection } from "./VenueForm/GallerySection"
import { PropertyPicker } from "./VenueForm/PropertyPicker"
import {
  buildInitialWeeklyHours,
  WeeklyHoursEditor,
} from "./VenueForm/WeeklyHoursEditor"

interface VenueFormProps {
  defaultValues?: EventVenuePublic
  onSuccess: () => void
}

// Booking mode options
const BOOKING_MODE_OPTIONS: { value: VenueBookingMode; label: string }[] = [
  { value: "free", label: "Free" },
  { value: "approval_required", label: "Approval required" },
  { value: "unbookable", label: "Unbookable" },
]

/**
 * Extract latitude and longitude from a Google Maps URL.
 *
 * Supports:
 * - https://www.google.com/maps/place/.../@-34.6037,-58.3816,17z/...
 * - https://www.google.com/maps?q=-34.6037,-58.3816
 * - https://maps.google.com/?ll=-34.6037,-58.3816
 * - https://www.google.com/maps/@-34.6037,-58.3816,17z
 * - URLs with !3d (lat) and !4d (lng) params
 */
function parseGoogleMapsUrl(url: string): { lat: number; lng: number } | null {
  if (!url) return null
  try {
    const atMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/)
    if (atMatch) {
      return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) }
    }
    const qMatch = url.match(/[?&](?:q|ll)=(-?\d+\.?\d*),(-?\d+\.?\d*)/)
    if (qMatch) {
      return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) }
    }
    const dMatch = url.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/)
    if (dMatch) {
      return { lat: parseFloat(dMatch[1]), lng: parseFloat(dMatch[2]) }
    }
  } catch {
    // ignore parse errors
  }
  return null
}

/** Check if URL is a Google Maps short link (goo.gl, maps.app.goo.gl) */
function isShortMapsLink(url: string): boolean {
  return /^https?:\/\/(goo\.gl|maps\.app\.goo\.gl)\//.test(url)
}

async function resolveShortLink(url: string): Promise<string | null> {
  try {
    const baseUrl = import.meta.env.VITE_API_URL || ""
    const res = await fetch(
      `${baseUrl}/api/v1/utils/resolve-url?url=${encodeURIComponent(url)}`,
    )
    if (res.ok) {
      const data = await res.json()
      return data.resolved_url ?? null
    }
  } catch {
    // Fallback: ignore
  }
  return null
}

// ---- Main form ----

export function VenueForm({ defaultValues, onSuccess }: VenueFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { selectedPopupId } = useWorkspace()
  const { isAdmin } = useAuth()
  const readOnly = !isAdmin
  const isEdit = !!defaultValues

  const createMutation = useMutation({
    mutationFn: async (args: {
      data: EventVenueCreate
      hours: VenueWeeklyHourInput[]
    }) => {
      const created = await EventVenuesService.createVenue({
        requestBody: args.data,
      })
      if (created?.id) {
        await EventVenuesService.setWeeklyHours({
          venueId: created.id,
          requestBody: { hours: args.hours },
        })
      }
      return created
    },
    onSuccess: () => {
      showSuccessToast("Venue created successfully")
      queryClient.invalidateQueries({ queryKey: ["event-venues"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: async (args: {
      data: EventVenueUpdate
      hours: VenueWeeklyHourInput[]
    }) => {
      const updated = await EventVenuesService.updateVenue({
        venueId: defaultValues!.id,
        requestBody: args.data,
      })
      await EventVenuesService.setWeeklyHours({
        venueId: defaultValues!.id,
        requestBody: { hours: args.hours },
      })
      return updated
    },
    onSuccess: () => {
      showSuccessToast("Venue updated successfully")
      queryClient.invalidateQueries({ queryKey: ["event-venues"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      EventVenuesService.deleteVenue({ venueId: defaultValues!.id }),
    onSuccess: () => {
      showSuccessToast("Venue deleted successfully")
      queryClient.invalidateQueries({ queryKey: ["event-venues"] })
      navigate({ to: "/events/venues" })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const buildMapsLink = (lat: number | null, lng: number | null) => {
    if (lat != null && lng != null) {
      return `https://www.google.com/maps/@${lat},${lng},17z`
    }
    return ""
  }

  const initialPropertyIds = useMemo(
    () => defaultValues?.properties?.map((p) => p.id) ?? [],
    [defaultValues],
  )

  // Existing tag / amenity suggestions — pulled from other venues in the
  // current popup so the author can pick from values already in use.
  const { data: popupVenues } = useQuery({
    queryKey: ["event-venues", { popupId: selectedPopupId, limit: 200 }],
    queryFn: () =>
      EventVenuesService.listVenues({ popupId: selectedPopupId!, limit: 200 }),
    enabled: !!selectedPopupId,
  })
  const existingTags = useMemo(
    () =>
      Array.from(
        new Set((popupVenues?.results ?? []).flatMap((v) => v.tags ?? [])),
      ).sort(),
    [popupVenues],
  )
  const existingAmenities = useMemo(
    () =>
      Array.from(
        new Set((popupVenues?.results ?? []).flatMap((v) => v.amenities ?? [])),
      ).sort(),
    [popupVenues],
  )

  const form = useForm({
    defaultValues: {
      title: defaultValues?.title ?? "",
      description: defaultValues?.description ?? "",
      location: defaultValues?.location ?? "",
      google_maps_link: buildMapsLink(
        defaultValues?.geo_lat ?? null,
        defaultValues?.geo_lng ?? null,
      ),
      capacity: defaultValues?.capacity?.toString() ?? "",
      image_url: defaultValues?.image_url ?? "",
      booking_mode: (defaultValues?.booking_mode ?? "free") as VenueBookingMode,
      setup_time_minutes: (defaultValues?.setup_time_minutes ?? 0).toString(),
      teardown_time_minutes: (
        defaultValues?.teardown_time_minutes ?? 0
      ).toString(),
      property_type_ids: initialPropertyIds,
      tags: (defaultValues?.tags ?? []) as string[],
      amenities: (defaultValues?.amenities ?? []) as string[],
      weekly_hours: buildInitialWeeklyHours(defaultValues?.weekly_hours),
    },
    onSubmit: ({ value }) => {
      if (readOnly) return
      if (!selectedPopupId && !isEdit) {
        showErrorToast("Select a pop-up first")
        return
      }
      const coords = parseGoogleMapsUrl(value.google_maps_link)

      const tags = value.tags.map((t) => t.trim().toLowerCase()).filter(Boolean)
      const amenities = value.amenities
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)

      if (isEdit) {
        const payload: EventVenueUpdate = {
          title: value.title,
          description: value.description || null,
          location: value.location || null,
          formatted_address: value.location || null,
          geo_lat: coords?.lat ?? null,
          geo_lng: coords?.lng ?? null,
          capacity: value.capacity ? parseInt(value.capacity, 10) : null,
          image_url: value.image_url || null,
          booking_mode: value.booking_mode,
          setup_time_minutes: value.setup_time_minutes
            ? Math.max(0, parseInt(value.setup_time_minutes, 10))
            : 0,
          teardown_time_minutes: value.teardown_time_minutes
            ? Math.max(0, parseInt(value.teardown_time_minutes, 10))
            : 0,
          property_type_ids: value.property_type_ids,
          tags,
          amenities,
        }
        updateMutation.mutate({ data: payload, hours: value.weekly_hours })
      } else {
        if (!selectedPopupId) return
        const payload: EventVenueCreate = {
          popup_id: selectedPopupId,
          title: value.title,
          description: value.description || null,
          location: value.location || null,
          formatted_address: value.location || null,
          geo_lat: coords?.lat ?? null,
          geo_lng: coords?.lng ?? null,
          capacity: value.capacity ? parseInt(value.capacity, 10) : null,
          image_url: value.image_url || null,
          booking_mode: value.booking_mode,
          setup_time_minutes: value.setup_time_minutes
            ? Math.max(0, parseInt(value.setup_time_minutes, 10))
            : 0,
          teardown_time_minutes: value.teardown_time_minutes
            ? Math.max(0, parseInt(value.teardown_time_minutes, 10))
            : 0,
          property_type_ids: value.property_type_ids,
          tags,
          amenities,
        }
        createMutation.mutate({ data: payload, hours: value.weekly_hours })
      }
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  // Track Google Maps link for coordinate preview
  const [mapsLink, setMapsLink] = useState(
    buildMapsLink(
      defaultValues?.geo_lat ?? null,
      defaultValues?.geo_lng ?? null,
    ),
  )
  const [resolving, setResolving] = useState(false)
  const parsedCoords = parseGoogleMapsUrl(mapsLink)

  const handleMapsLinkChange = async (
    url: string,
    fieldChange: (v: string) => void,
  ) => {
    fieldChange(url)
    setMapsLink(url)

    if (isShortMapsLink(url)) {
      setResolving(true)
      const resolved = await resolveShortLink(url)
      if (resolved) {
        fieldChange(resolved)
        setMapsLink(resolved)
      }
      setResolving(false)
    }
  }

  const blocker = useUnsavedChanges(form)

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (readOnly) return
          form.handleSubmit()
        }}
        className="mx-auto max-w-3xl space-y-8"
      >
        <form.Field
          name="title"
          validators={{
            onBlur: ({ value }) =>
              !readOnly && !value.trim() ? "Venue name is required" : undefined,
          }}
        >
          {(field) => (
            <div>
              <HeroInput
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder="Venue Name"
                disabled={readOnly}
              />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>

        <InlineSection title="Description">
          <InlineRow
            label="Description"
            description="Shown to humans next to the opening hours when they pick this venue."
          >
            <form.Field name="description">
              {(field) => (
                <Textarea
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="Accessibility notes, quirks, vibe, capacity details…"
                  rows={3}
                  disabled={readOnly}
                />
              )}
            </form.Field>
          </InlineRow>
        </InlineSection>

        {/* 1. Basic */}
        <InlineSection title="Location">
          <InlineRow label="Address" description="Location description">
            <form.Field name="location">
              {(field) => (
                <Input
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="Address or place name"
                  disabled={readOnly}
                />
              )}
            </form.Field>
          </InlineRow>

          <InlineRow
            label="Google Maps Link"
            description="Paste a Google Maps share link to extract coordinates"
          >
            <div className="space-y-1.5">
              <form.Field name="google_maps_link">
                {(field) => (
                  <Input
                    value={field.state.value}
                    onChange={(e) =>
                      handleMapsLinkChange(e.target.value, field.handleChange)
                    }
                    placeholder="Paste Google Maps link (share or full URL)"
                    disabled={readOnly}
                  />
                )}
              </form.Field>
              {resolving && (
                <p className="text-xs text-muted-foreground">
                  Resolving short link...
                </p>
              )}
              {mapsLink && !resolving && (
                <p className="text-xs text-muted-foreground">
                  {parsedCoords
                    ? `Coordinates: ${parsedCoords.lat.toFixed(6)}, ${parsedCoords.lng.toFixed(6)}`
                    : isShortMapsLink(mapsLink)
                      ? "Could not resolve short link. Try pasting the full URL from the browser address bar."
                      : "Could not extract coordinates from this link"}
                </p>
              )}
            </div>
          </InlineRow>

          <InlineRow label="Capacity" description="Max number of people">
            <form.Field name="capacity">
              {(field) => (
                <Input
                  type="number"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="Unlimited"
                  disabled={readOnly}
                />
              )}
            </form.Field>
          </InlineRow>
        </InlineSection>

        {/* 2. Main photo */}
        <InlineSection title="Main photo">
          <div className="py-3">
            <form.Field name="image_url">
              {(field) => (
                <ImageUpload
                  value={field.state.value || null}
                  onChange={(url) => field.handleChange(url ?? "")}
                  disabled={readOnly}
                />
              )}
            </form.Field>
          </div>
        </InlineSection>

        {/* Gallery (edit mode only) */}
        {isEdit && defaultValues && (
          <GallerySection venueId={defaultValues.id} />
        )}

        {/* 3. Booking */}
        <InlineSection title="Booking">
          <InlineRow
            label="Booking mode"
            description="How participants can book this venue"
          >
            <form.Field name="booking_mode">
              {(field) => (
                <Select
                  value={field.state.value}
                  onValueChange={(v) =>
                    field.handleChange(v as VenueBookingMode)
                  }
                  disabled={readOnly}
                >
                  <SelectTrigger className="w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BOOKING_MODE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </form.Field>
          </InlineRow>

          <InlineRow label="Setup time (minutes)">
            <form.Field name="setup_time_minutes">
              {(field) => (
                <Input
                  type="number"
                  min={0}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="0"
                  className="w-[120px]"
                  disabled={readOnly}
                />
              )}
            </form.Field>
          </InlineRow>

          <InlineRow label="Teardown time (minutes)">
            <form.Field name="teardown_time_minutes">
              {(field) => (
                <Input
                  type="number"
                  min={0}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="0"
                  className="w-[120px]"
                  disabled={readOnly}
                />
              )}
            </form.Field>
          </InlineRow>
          <p className="px-1 py-2 text-xs text-muted-foreground">
            Venue is locked setup_time_minutes before the event start and
            teardown_time_minutes after the end.
          </p>
        </InlineSection>

        {/* 4. Properties */}
        <form.Field name="property_type_ids">
          {(field) => (
            <PropertyPicker
              value={field.state.value}
              onChange={field.handleChange}
              disabled={readOnly}
            />
          )}
        </form.Field>

        {/* 5. Weekly hours */}
        <form.Field name="weekly_hours">
          {(field) => (
            <WeeklyHoursEditor
              value={field.state.value}
              onChange={field.handleChange}
              disabled={readOnly}
            />
          )}
        </form.Field>

        {/* 6. Exceptions (edit mode only) */}
        {isEdit && defaultValues && (
          <ExceptionsEditor venueId={defaultValues.id} />
        )}

        {/* 7. Tags + amenities */}
        <InlineSection title="Details">
          <InlineRow
            label="Tags"
            description="Type to search or add new. Enter to confirm."
          >
            <form.Field name="tags">
              {(field) => (
                <ChipsWithSuggestions
                  value={field.state.value}
                  onChange={field.handleChange}
                  suggestions={existingTags}
                  placeholder="outdoor, rooftop, lounge"
                  disabled={readOnly}
                />
              )}
            </form.Field>
          </InlineRow>

          <InlineRow
            label="Amenities"
            description="Type to search or add new. Enter to confirm."
          >
            <form.Field name="amenities">
              {(field) => (
                <ChipsWithSuggestions
                  value={field.state.value}
                  onChange={field.handleChange}
                  suggestions={existingAmenities}
                  placeholder="wifi, projector, whiteboard"
                  disabled={readOnly}
                />
              )}
            </form.Field>
          </InlineRow>
        </InlineSection>

        <div className="flex gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: "/events/venues" })}
          >
            {readOnly ? "Back" : "Cancel"}
          </Button>
          {!readOnly && (
            <LoadingButton type="submit" loading={isPending}>
              {isEdit ? "Save Changes" : "Create Venue"}
            </LoadingButton>
          )}
        </div>
      </form>

      {isEdit && !readOnly && defaultValues && (
        <div className="mx-auto max-w-3xl">
          <DangerZone
            description="Once you delete this venue, events referencing it will lose the reference. This action cannot be undone."
            onDelete={() => deleteMutation.mutate()}
            isDeleting={deleteMutation.isPending}
            confirmText="Delete Venue"
            resourceName={defaultValues.title || "Untitled venue"}
            variant="inline"
          />
        </div>
      )}
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}
