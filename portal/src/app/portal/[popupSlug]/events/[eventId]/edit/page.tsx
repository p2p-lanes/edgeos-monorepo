"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  Image as ImageIcon,
  Loader2,
  Save,
  Upload,
  X,
} from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import {
  ApiError,
  EventsService,
  type EventUpdate,
  type EventVenuePublic,
  EventVenuesService,
  HumansService,
  type TrackPublic,
  TracksService,
} from "@/client"
import { CoverImageCropper } from "@/components/CoverImageCropper"
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
import { VenueHoursSummary } from "@/components/VenueHoursSummary"
import { useCityProvider } from "@/providers/cityProvider"
import { useEventTimezone } from "../../lib/useEventTimezone"
import { useFileUpload } from "../../lib/useFileUpload"

type Visibility = "public" | "private" | "unlisted"

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function EditPortalEventPage() {
  const { t } = useTranslation()
  const params = useParams<{ popupSlug: string; eventId: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { getCity } = useCityProvider()
  const city = getCity()
  const { timezone } = useEventTimezone(city?.id)
  const { uploadFile, isUploading } = useFileUpload()
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: event, isLoading } = useQuery({
    queryKey: ["portal-event", params.eventId],
    queryFn: () => EventsService.getPortalEvent({ eventId: params.eventId }),
    enabled: !!params.eventId,
  })

  const { data: currentHuman } = useQuery({
    queryKey: ["current-human"],
    queryFn: () => HumansService.getCurrentHumanInfo(),
    staleTime: 5 * 60 * 1000,
  })

  const isOwner =
    event != null && currentHuman != null && event.owner_id === currentHuman.id

  const { data: venuesData } = useQuery({
    queryKey: ["portal-event-venues", city?.id],
    queryFn: () =>
      EventVenuesService.listPortalVenues({ popupId: city!.id, limit: 200 }),
    enabled: !!city?.id,
  })
  const venues: EventVenuePublic[] = venuesData?.results ?? []

  const { data: tracksData } = useQuery({
    queryKey: ["portal-tracks", city?.id],
    queryFn: () =>
      TracksService.listPortalTracks({ popupId: city!.id, limit: 200 }),
    enabled: !!city?.id,
  })
  const tracks: TrackPublic[] = tracksData?.results ?? []

  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [venueId, setVenueId] = useState("")
  const [trackId, setTrackId] = useState("")
  const [startLocal, setStartLocal] = useState("")
  const [endLocal, setEndLocal] = useState("")
  const [visibility, setVisibility] = useState<Visibility>("public")
  const [maxParticipants, setMaxParticipants] = useState("")
  const [meetingUrl, setMeetingUrl] = useState("")
  const [coverUrl, setCoverUrl] = useState("")
  const [pendingCrop, setPendingCrop] = useState<{
    url: string
    name: string
  } | null>(null)

  // Hydrate form state whenever the event loads / changes.
  useEffect(() => {
    if (!event) return
    setTitle(event.title ?? "")
    setContent(event.content ?? "")
    setVenueId(event.venue_id ?? "")
    setTrackId(event.track_id ?? "")
    setStartLocal(toLocalInput(new Date(event.start_time)))
    setEndLocal(toLocalInput(new Date(event.end_time)))
    setVisibility((event.visibility as Visibility) ?? "public")
    setMaxParticipants(
      event.max_participant != null ? String(event.max_participant) : "",
    )
    setMeetingUrl(event.meeting_url ?? "")
    setCoverUrl(event.cover_url ?? "")
  }, [event])

  const selectedVenue = useMemo(
    () => venues.find((v) => v.id === venueId),
    [venues, venueId],
  )

  const updateMutation = useMutation({
    mutationFn: (payload: EventUpdate) =>
      EventsService.updatePortalEvent({
        eventId: params.eventId,
        requestBody: payload,
      }),
    onSuccess: () => {
      toast.success(t("events.form.event_updated_success"))
      queryClient.invalidateQueries({ queryKey: ["portal-event"] })
      queryClient.invalidateQueries({ queryKey: ["portal-events"] })
      router.push(`/portal/${city?.slug}/events/${params.eventId}`)
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError
          ? ((err.body as { detail?: string })?.detail ?? err.message)
          : (err as Error).message
      toast.error(msg)
    },
  })

  const onPickFile = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const file = files[0]
    setPendingCrop({ url: URL.createObjectURL(file), name: file.name })
  }

  const handleCropConfirm = async (blob: Blob) => {
    if (!pendingCrop) return
    try {
      const file = new File(
        [blob],
        pendingCrop.name.replace(/\.\w+$/, ".jpg"),
        {
          type: "image/jpeg",
        },
      )
      const { publicUrl } = await uploadFile(file)
      setCoverUrl(publicUrl)
      toast.success(t("events.form.image_uploaded_success"))
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!event) return
    const payload: EventUpdate = {
      title: title.trim(),
      content: content.trim() || null,
      start_time: new Date(startLocal).toISOString(),
      end_time: new Date(endLocal).toISOString(),
      venue_id: venueId || null,
      track_id: trackId || null,
      visibility: visibility,
      max_participant: maxParticipants
        ? Number.parseInt(maxParticipants, 10)
        : null,
      meeting_url: meetingUrl || null,
      cover_url: coverUrl || null,
    }
    updateMutation.mutate(payload)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  if (!event) {
    return (
      <div className="max-w-2xl mx-auto p-4 sm:p-6 text-center py-20">
        <ImageIcon className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
        <p className="text-muted-foreground">
          {t("events.detail.event_not_found")}
        </p>
      </div>
    )
  }

  if (!isOwner) {
    return (
      <div className="max-w-2xl mx-auto p-4 sm:p-6 text-center py-20">
        <h1 className="text-xl font-semibold">
          {t("events.form.not_your_event_heading")}
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          {t("events.form.not_your_event_message")}
        </p>
        <Link
          href={`/portal/${city?.slug}/events/${params.eventId}`}
          className="mt-4 inline-block text-sm underline"
        >
          {t("events.form.back_to_event")}
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
      <Link
        href={`/portal/${city?.slug}/events/${params.eventId}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {t("events.form.back_to_event")}
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("events.form.edit_heading")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {timezone
            ? t("events.form.edit_subheading_with_tz", {
                cityName: city?.name ?? "",
                timezone,
              })
            : t("events.form.edit_subheading", {
                cityName: city?.name ?? "",
              })}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Title */}
        <div className="space-y-2">
          <Label htmlFor="title">{t("events.form.title_label")}</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>

        {/* Cover */}
        <div className="space-y-2">
          <Label>{t("events.form.cover_image_label_edit")}</Label>
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
          {coverUrl ? (
            <div className="relative w-full overflow-hidden rounded-lg border">
              {/* biome-ignore lint/performance/noImgElement: user-uploaded S3 image */}
              <img
                src={coverUrl}
                alt={t("events.form.event_cover_alt")}
                className="aspect-[16/9] w-full object-cover"
              />
              <div className="absolute top-2 right-2 flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="mr-1 h-4 w-4" />{" "}
                  {t("events.form.replace_button")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setCoverUrl("")}
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
              {t("events.form.upload_image_button")}
            </Button>
          )}
        </div>

        {/* Venue */}
        <div className="space-y-2">
          <Label>{t("events.form.venue_label")}</Label>
          <Select
            value={venueId || "__none__"}
            onValueChange={(v) => setVenueId(v === "__none__" ? "" : v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("events.form.venue_placeholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">
                {t("events.form.no_venue_option")}
              </SelectItem>
              {venues.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.title || t("events.venues.list.untitled_venue")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedVenue && (
            <VenueHoursSummary hours={selectedVenue.weekly_hours} />
          )}
        </div>

        {/* Times */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="start">{t("events.form.start_label")}</Label>
            <Input
              id="start"
              type="datetime-local"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="end">{t("events.form.end_label")}</Label>
            <Input
              id="end"
              type="datetime-local"
              value={endLocal}
              onChange={(e) => setEndLocal(e.target.value)}
              required
            />
          </div>
        </div>

        {/* Visibility */}
        <div className="space-y-2">
          <Label>{t("events.form.visibility_label")}</Label>
          <Select
            value={visibility}
            onValueChange={(v) => setVisibility(v as Visibility)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="public">
                {t("events.form.visibility_public")}
              </SelectItem>
              <SelectItem value="private">
                {t("events.form.visibility_private_short")}
              </SelectItem>
              <SelectItem value="unlisted">
                {t("events.form.visibility_unlisted_short")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Max participants */}
        <div className="space-y-2">
          <Label htmlFor="max">{t("events.form.max_participants_label")}</Label>
          <Input
            id="max"
            type="number"
            min={0}
            value={maxParticipants}
            onChange={(e) => setMaxParticipants(e.target.value)}
          />
        </div>

        {/* Meeting URL */}
        <div className="space-y-2">
          <Label htmlFor="meeting">{t("events.form.meeting_url_label")}</Label>
          <Input
            id="meeting"
            type="url"
            value={meetingUrl}
            onChange={(e) => setMeetingUrl(e.target.value)}
            placeholder={t("events.form.meeting_url_placeholder")}
          />
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="desc">{t("events.form.description_label")}</Label>
          <Textarea
            id="desc"
            rows={4}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        {/* Track */}
        {tracks.length > 0 && (
          <div className="space-y-2">
            <Label>{t("events.form.track_label")}</Label>
            <Select
              value={trackId || "__none__"}
              onValueChange={(v) => setTrackId(v === "__none__" ? "" : v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("events.form.track_placeholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  {t("events.form.no_track_option")}
                </SelectItem>
                {tracks.map((tr) => (
                  <SelectItem key={tr.id} value={tr.id}>
                    {tr.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              router.push(`/portal/${city?.slug}/events/${params.eventId}`)
            }
          >
            {t("events.form.cancel_button")}
          </Button>
          <Button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {t("events.form.save_button")}
          </Button>
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
