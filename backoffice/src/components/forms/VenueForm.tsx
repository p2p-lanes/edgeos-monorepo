import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import {
  type EventVenueCreate,
  type EventVenuePublic,
  EventVenuesService,
} from "@/client"
import { Input } from "@/components/ui/input"
import {
  HeroInput,
  InlineRow,
  InlineSection,
} from "@/components/ui/inline-form"
import { LoadingButton } from "@/components/ui/loading-button"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

interface VenueFormProps {
  defaultValues?: EventVenuePublic
  onSuccess: () => void
}

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
    // Pattern 1: /@lat,lng or @lat,lng
    const atMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/)
    if (atMatch) {
      return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) }
    }
    // Pattern 2: ?q=lat,lng or ?ll=lat,lng
    const qMatch = url.match(/[?&](?:q|ll)=(-?\d+\.?\d*),(-?\d+\.?\d*)/)
    if (qMatch) {
      return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) }
    }
    // Pattern 3: /place/.../ with !3d (lat) and !4d (lng)
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

/**
 * Resolve a short Google Maps link by following the redirect.
 * Uses the backend as a proxy to avoid CORS issues.
 */
async function resolveShortLink(url: string): Promise<string | null> {
  try {
    // Use a HEAD request to get the redirect Location without CORS issues.
    // Short links redirect to the full URL. We proxy through our backend.
    const baseUrl = import.meta.env.VITE_API_URL || ""
    const res = await fetch(
      `${baseUrl}/api/v1/utils/resolve-url?url=${encodeURIComponent(url)}`
    )
    if (res.ok) {
      const data = await res.json()
      return data.resolved_url ?? null
    }
  } catch {
    // Fallback: try direct fetch (may fail due to CORS)
  }
  return null
}

export function VenueForm({ defaultValues, onSuccess }: VenueFormProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { selectedPopupId } = useWorkspace()
  const isEdit = !!defaultValues

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      EventVenuesService.createVenue({ requestBody: data as EventVenueCreate }),
    onSuccess: () => {
      showSuccessToast("Venue created successfully")
      queryClient.invalidateQueries({ queryKey: ["event-venues"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      EventVenuesService.updateVenue({
        venueId: defaultValues!.id,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("Venue updated successfully")
      queryClient.invalidateQueries({ queryKey: ["event-venues"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const buildMapsLink = (lat: number | null, lng: number | null) => {
    if (lat != null && lng != null) {
      return `https://www.google.com/maps/@${lat},${lng},17z`
    }
    return ""
  }

  const form = useForm({
    defaultValues: {
      title: defaultValues?.title ?? "",
      location: defaultValues?.location ?? "",
      google_maps_link: buildMapsLink(
        defaultValues?.geo_lat ?? null,
        defaultValues?.geo_lng ?? null,
      ),
      capacity: defaultValues?.capacity?.toString() ?? "",
      image_url: defaultValues?.image_url ?? "",
    },
    onSubmit: ({ value }) => {
      const coords = parseGoogleMapsUrl(value.google_maps_link)

      const payload: Record<string, unknown> = {
        popup_id: selectedPopupId,
        title: value.title,
        location: value.location || null,
        formatted_address: value.location || null,
        geo_lat: coords?.lat ?? null,
        geo_lng: coords?.lng ?? null,
        capacity: value.capacity ? parseInt(value.capacity) : null,
        image_url: value.image_url || null,
      }

      if (isEdit) {
        updateMutation.mutate(payload)
      } else {
        createMutation.mutate(payload)
      }
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  // Track Google Maps link for coordinate preview
  const [mapsLink, setMapsLink] = useState(
    buildMapsLink(defaultValues?.geo_lat ?? null, defaultValues?.geo_lng ?? null)
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

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.handleSubmit()
      }}
      className="space-y-8"
    >
      <form.Field name="title">
        {(field) => (
          <HeroInput
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            onBlur={field.handleBlur}
            placeholder="Venue Name"
          />
        )}
      </form.Field>

      <InlineSection title="Location">
        <InlineRow label="Address" description="Location description">
          <form.Field name="location">
            {(field) => (
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="Address or place name"
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
                />
              )}
            </form.Field>
            {resolving && (
              <p className="text-xs text-muted-foreground">Resolving short link...</p>
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
      </InlineSection>

      <InlineSection title="Details">
        <InlineRow label="Capacity" description="Max number of people">
          <form.Field name="capacity">
            {(field) => (
              <Input
                type="number"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="Unlimited"
              />
            )}
          </form.Field>
        </InlineRow>

        <InlineRow label="Image URL">
          <form.Field name="image_url">
            {(field) => (
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="https://..."
              />
            )}
          </form.Field>
        </InlineRow>
      </InlineSection>

      <div className="flex justify-end gap-3">
        <LoadingButton type="submit" loading={isPending}>
          {isEdit ? "Save Changes" : "Create Venue"}
        </LoadingButton>
      </div>
    </form>
  )
}
