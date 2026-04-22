"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import {
  ArrowLeft,
  CircleAlert,
  Hourglass,
  Loader2,
  MapPin,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import {
  ApiError,
  EventVenuesService,
  VenuePropertyTypesService,
} from "@/client"
import { LucideIcon } from "@/components/LucideIcon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useCityProvider } from "@/providers/cityProvider"
import { usePortalEventSettings } from "../../lib/useEventTimezone"

/**
 * Portal venue creation form.
 *
 * Gating is driven by popup event settings:
 * - ``humans_can_create_venues = false`` → this page 403s (blocked UI).
 * - ``venues_require_approval = true`` → created venue lands in
 *   ``PENDING``; we redirect back to the list with a heads-up that an
 *   admin still has to approve it before it's visible.
 * - Otherwise the venue is ``ACTIVE`` and we jump straight to its detail.
 */
export default function NewPortalVenuePage() {
  const { t } = useTranslation()
  const router = useRouter()
  const { getCity } = useCityProvider()
  const city = getCity()
  const popupId = city?.id
  const popupSlug = city?.slug

  const { data: settings, isLoading: settingsLoading } =
    usePortalEventSettings(popupId)
  const canCreate = settings?.humans_can_create_venues === true
  const requiresApproval = settings?.venues_require_approval === true

  const { data: propertyTypes } = useQuery({
    queryKey: ["portal-venue-property-types"],
    queryFn: () => VenuePropertyTypesService.listPropertyTypesPortal(),
    enabled: canCreate,
    staleTime: 5 * 60 * 1000,
  })

  const [title, setTitle] = useState("")
  const [location, setLocation] = useState("")
  const [capacity, setCapacity] = useState("")
  const [bookingMode, setBookingMode] = useState<
    "free" | "approval_required" | "unbookable"
  >("free")
  const [propertyIds, setPropertyIds] = useState<Set<string>>(new Set())

  const toggleProperty = (id: string) => {
    setPropertyIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!popupId) throw new Error(t("events.venues.new.no_popup_error"))
      const capacityNum = capacity.trim() ? Number(capacity) : null
      return EventVenuesService.createPortalVenue({
        requestBody: {
          popup_id: popupId,
          title: title.trim(),
          location: location.trim() || null,
          capacity:
            capacityNum != null && !Number.isNaN(capacityNum)
              ? capacityNum
              : null,
          booking_mode: bookingMode,
          property_type_ids: Array.from(propertyIds),
        },
      })
    },
    onSuccess: (venue) => {
      if (venue.status === "pending") {
        toast.success(t("events.venues.new.venue_submitted_success"))
        router.push(`/portal/${popupSlug}/events/venues`)
      } else {
        toast.success(t("events.venues.new.venue_created_success"))
        router.push(`/portal/${popupSlug}/events/venues/${venue.id}`)
      }
    },
    onError: (err) => {
      const fallback = t("events.venues.new.failed_to_create")
      const msg =
        err instanceof ApiError && typeof err.body === "object"
          ? ((err.body as { detail?: string }).detail ?? fallback)
          : fallback
      toast.error(msg)
    },
  })

  // ---- render gates ----
  if (settingsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!canCreate) {
    return (
      <div className="max-w-xl mx-auto p-6 text-center">
        <CircleAlert className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
        <h1 className="text-lg font-semibold">
          {t("events.venues.new.venue_not_available")}
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          {t("events.venues.new.venue_not_available_message", {
            cityName: city?.name,
          })}
        </p>
        <Link
          href={`/portal/${popupSlug}/events/venues`}
          className="inline-flex items-center gap-1 text-sm text-primary mt-6"
        >
          <ArrowLeft className="h-4 w-4" />{" "}
          {t("events.venues.new.back_to_venues")}
        </Link>
      </div>
    )
  }

  const canSubmit = title.trim().length > 0 && !createMutation.isPending

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6">
      <Link
        href={`/portal/${popupSlug}/events/venues`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft className="h-4 w-4" />{" "}
        {t("events.venues.new.back_to_venues")}
      </Link>

      <div className="flex items-center gap-2 mb-1">
        <MapPin className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">
          {t("events.venues.new.heading")}
        </h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        {t("events.venues.new.subheading", { cityName: city?.name })}
        {requiresApproval && (
          <>
            {" "}
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
              <Hourglass className="h-3 w-3" />{" "}
              {t("events.venues.new.requires_approval_note")}
            </span>
          </>
        )}
      </p>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSubmit) createMutation.mutate()
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="title">
            {t("events.venues.new.title_label")}{" "}
            <span className="text-destructive">*</span>
          </Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("events.venues.new.title_placeholder")}
            required
            maxLength={255}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="location">
            {t("events.venues.new.location_label")}
          </Label>
          <Textarea
            id="location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={t("events.venues.new.location_placeholder")}
            rows={2}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="capacity">
              {t("events.venues.new.capacity_label")}
            </Label>
            <Input
              id="capacity"
              type="number"
              inputMode="numeric"
              min={0}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder={t("events.venues.new.capacity_placeholder")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="booking_mode">
              {t("events.venues.new.booking_label")}
            </Label>
            <Select
              value={bookingMode}
              onValueChange={(v) => setBookingMode(v as typeof bookingMode)}
            >
              <SelectTrigger id="booking_mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">
                  {t("events.venues.new.booking_free")}
                </SelectItem>
                <SelectItem value="approval_required">
                  {t("events.venues.new.booking_approval")}
                </SelectItem>
                <SelectItem value="unbookable">
                  {t("events.venues.new.booking_unbookable")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {propertyTypes && propertyTypes.length > 0 && (
          <div className="space-y-2">
            <Label>{t("events.venues.new.properties_label")}</Label>
            <div className="flex flex-wrap gap-2">
              {propertyTypes.map((pt) => {
                const selected = propertyIds.has(pt.id)
                return (
                  <button
                    key={pt.id}
                    type="button"
                    onClick={() => toggleProperty(pt.id)}
                    aria-pressed={selected}
                    className={
                      selected
                        ? "inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary/10 text-primary px-2.5 py-1 text-xs"
                        : "inline-flex items-center gap-1.5 rounded-md border bg-card hover:bg-muted px-2.5 py-1 text-xs text-muted-foreground"
                    }
                  >
                    <LucideIcon name={pt.icon} className="h-3.5 w-3.5" />
                    {pt.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          <Button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center gap-2"
          >
            {createMutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            {t("events.venues.new.create_button")}
          </Button>
          <Link
            href={`/portal/${popupSlug}/events/venues`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {t("events.venues.new.cancel_button")}
          </Link>
        </div>
      </form>
    </div>
  )
}
