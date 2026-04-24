"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, CircleAlert, Loader2, Upload, X } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import {
  ApiError,
  type EventVenuePublic,
  EventVenuesService,
  HumansService,
  VenuePropertyTypesService,
} from "@/client"
import { CoverImageCropper } from "@/components/CoverImageCropper"
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
import { useFileUpload } from "../../../lib/useFileUpload"

type BookingMode = "free" | "approval_required" | "unbookable"

export default function EditPortalVenuePage() {
  const { t } = useTranslation()
  const router = useRouter()
  const params = useParams<{ popupSlug: string; venueId: string }>()
  const queryClient = useQueryClient()
  const { getCity } = useCityProvider()
  const city = getCity()
  const popupSlug = city?.slug

  const { data: currentHuman } = useQuery({
    queryKey: ["current-human"],
    queryFn: () => HumansService.getCurrentHumanInfo(),
    staleTime: 5 * 60 * 1000,
  })

  // Same pattern as the detail page: no single-venue portal endpoint, so we
  // pull the list and pick the match.
  const { data: venuesList, isLoading } = useQuery({
    queryKey: ["portal-event-venues", city?.id],
    queryFn: () =>
      EventVenuesService.listPortalVenues({ popupId: city!.id, limit: 200 }),
    enabled: !!city?.id,
  })
  const venue: EventVenuePublic | undefined = venuesList?.results.find(
    (v) => v.id === params.venueId,
  )

  const { data: propertyTypes } = useQuery({
    queryKey: ["portal-venue-property-types"],
    queryFn: () => VenuePropertyTypesService.listPropertyTypesPortal(),
    staleTime: 5 * 60 * 1000,
  })

  const [title, setTitle] = useState("")
  const [location, setLocation] = useState("")
  const [capacity, setCapacity] = useState("")
  const [bookingMode, setBookingMode] = useState<BookingMode>("free")
  const [propertyIds, setPropertyIds] = useState<Set<string>>(new Set())
  const [imageUrl, setImageUrl] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)
  const { uploadFile, isUploading } = useFileUpload()
  const [pendingCrop, setPendingCrop] = useState<{
    url: string
    name: string
  } | null>(null)

  // Hydrate form state once the venue loads.
  useEffect(() => {
    if (!venue) return
    setTitle(venue.title ?? "")
    setLocation(venue.location ?? "")
    setCapacity(venue.capacity != null ? String(venue.capacity) : "")
    setBookingMode((venue.booking_mode as BookingMode) ?? "free")
    setPropertyIds(new Set((venue.properties ?? []).map((p) => p.id)))
    setImageUrl(venue.image_url ?? "")
  }, [venue])

  const toggleProperty = (id: string) => {
    setPropertyIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const onPickFile = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const file = files[0]
    const url = URL.createObjectURL(file)
    setPendingCrop({ url, name: file.name })
  }

  const handleCropConfirm = async (blob: Blob) => {
    if (!pendingCrop) return
    try {
      const file = new File(
        [blob],
        pendingCrop.name.replace(/\.\w+$/, ".jpg"),
        { type: "image/jpeg" },
      )
      const { publicUrl } = await uploadFile(file)
      setImageUrl(publicUrl)
      toast.success(t("events.venues.new.image_uploaded_success"))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      URL.revokeObjectURL(pendingCrop.url)
      setPendingCrop(null)
    }
  }

  const handleCropCancel = () => {
    if (pendingCrop) URL.revokeObjectURL(pendingCrop.url)
    setPendingCrop(null)
  }

  const updateMutation = useMutation({
    mutationFn: () => {
      const capacityNum = capacity.trim() ? Number(capacity) : null
      return EventVenuesService.updatePortalVenue({
        venueId: params.venueId,
        requestBody: {
          title: title.trim(),
          location: location.trim() || null,
          capacity:
            capacityNum != null && !Number.isNaN(capacityNum)
              ? capacityNum
              : null,
          booking_mode: bookingMode,
          property_type_ids: Array.from(propertyIds),
          image_url: imageUrl || null,
        },
      })
    },
    onSuccess: () => {
      toast.success(t("events.venues.edit.venue_updated_success"))
      queryClient.invalidateQueries({ queryKey: ["portal-event-venues"] })
      router.push(`/portal/${popupSlug}/events/venues/${params.venueId}`)
    },
    onError: (err) => {
      const fallback = t("events.venues.edit.failed_to_update")
      const msg =
        err instanceof ApiError && typeof err.body === "object"
          ? ((err.body as { detail?: string }).detail ?? fallback)
          : fallback
      toast.error(msg)
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!venue) {
    return (
      <div className="max-w-xl mx-auto p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {t("events.venues.detail.venue_not_found")}
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

  const isOwner =
    currentHuman != null && venue.owner_id === currentHuman.id

  if (!isOwner) {
    return (
      <div className="max-w-xl mx-auto p-6 text-center">
        <CircleAlert className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
        <h1 className="text-lg font-semibold">
          {t("events.venues.edit.edit_not_allowed_heading")}
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          {t("events.venues.edit.edit_not_allowed_message")}
        </p>
        <Link
          href={`/portal/${popupSlug}/events/venues/${venue.id}`}
          className="inline-flex items-center gap-1 text-sm text-primary mt-6"
        >
          <ArrowLeft className="h-4 w-4" />{" "}
          {t("events.venues.edit.back_to_venue")}
        </Link>
      </div>
    )
  }

  const canSubmit = title.trim().length > 0 && !updateMutation.isPending

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6">
      <Link
        href={`/portal/${popupSlug}/events/venues/${venue.id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft className="h-4 w-4" />{" "}
        {t("events.venues.edit.back_to_venue")}
      </Link>

      <h1 className="text-2xl font-bold tracking-tight mb-1">
        {t("events.venues.edit.heading")}
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        {t("events.venues.edit.subheading")}
      </p>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSubmit) updateMutation.mutate()
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
          <Label>{t("events.venues.new.cover_image_label")}</Label>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={(e) => {
              onPickFile(e.target.files)
              e.target.value = ""
            }}
          />
          {imageUrl ? (
            <div className="relative w-full overflow-hidden rounded-lg border">
              {/* biome-ignore lint/performance/noImgElement: user-uploaded S3 image */}
              <img
                src={imageUrl}
                alt={t("events.venues.new.venue_cover_alt")}
                className="aspect-[16/9] w-full object-cover"
              />
              <div className="absolute top-2 right-2 flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="mr-1 h-4 w-4" />
                  {t("events.venues.new.replace_button")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setImageUrl("")}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={isUploading}
              onClick={() => fileRef.current?.click()}
            >
              {isUploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              {isUploading
                ? t("events.venues.new.uploading_button")
                : t("events.venues.new.upload_image_button")}
            </Button>
          )}
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
              onValueChange={(v) => setBookingMode(v as BookingMode)}
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
            {updateMutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            {t("events.venues.edit.save_button")}
          </Button>
          <Link
            href={`/portal/${popupSlug}/events/venues/${venue.id}`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {t("events.venues.edit.cancel_button")}
          </Link>
        </div>
      </form>

      {pendingCrop && (
        <CoverImageCropper
          src={pendingCrop.url}
          open={true}
          onCancel={handleCropCancel}
          onConfirm={handleCropConfirm}
          saving={isUploading}
        />
      )}
    </div>
  )
}
