"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import {
  ArrowLeft,
  Image as ImageIcon,
  Loader2,
  Plus,
  Upload,
  X,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import {
  ApiError,
  EventsService,
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
import { useCityProvider } from "@/providers/cityProvider"
import { EventScheduleFields } from "../components/EventScheduleFields"
import { EventVenueField } from "../components/EventVenueField"
import { todayInTz, useEventScheduling } from "../lib/useEventScheduling"
import {
  useEventTimezone,
  usePortalEventSettings,
} from "../lib/useEventTimezone"
import { useFileUpload } from "../lib/useFileUpload"
import { usePopupWindow } from "../lib/usePopupWindow"
import { useVenueAvailability } from "../lib/useVenueAvailability"

type Visibility = "public" | "private" | "unlisted"

export default function NewPortalEventPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const { getCity } = useCityProvider()
  const city = getCity()
  const popupId = city?.id
  const { timezone } = useEventTimezone(popupId)
  const displayTz = timezone || "UTC"

  const {
    popupStartKey,
    popupEndKey,
    isDateOutsidePopupWindow,
    popupWindowLabel,
  } = usePopupWindow({
    startDate: city?.start_date,
    endDate: city?.end_date,
  })

  const { uploadFile, isUploading } = useFileUpload()
  const fileRef = useRef<HTMLInputElement>(null)

  // ---- settings-driven gates ------------------------------------------
  const { data: settings, isLoading: settingsLoading } =
    usePortalEventSettings(popupId)
  const eventsEnabled = settings?.event_enabled ?? true
  const canCreate = (settings?.can_publish_event ?? "everyone") === "everyone"

  // ---- form state -----------------------------------------------------
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [venueId, setVenueId] = useState<string>("")

  const {
    dateStr,
    setDateStr,
    timeStr,
    setTimeStr,
    durationValue,
    setDurationValue,
    durationUnit,
    setDurationUnit,
    startIso,
    endIso,
    durationMinutes,
  } = useEventScheduling({ displayTz })

  // City loads asynchronously, so the popup window isn't known on first
  // render. When it arrives and today falls outside [start_date, end_date],
  // snap the date picker default to the popup's start_date so the calendar
  // opens on a valid month. One-shot — once the user picks a date themselves
  // we leave it alone.
  const didSnapDefaultsRef = useRef(false)
  useEffect(() => {
    if (didSnapDefaultsRef.current) return
    if (!popupStartKey && !popupEndKey) return
    didSnapDefaultsRef.current = true
    const todayKey = todayInTz(displayTz)
    const todayInWindow =
      (!popupStartKey || todayKey >= popupStartKey) &&
      (!popupEndKey || todayKey <= popupEndKey)
    if (todayInWindow) return
    const targetDate = popupStartKey ?? popupEndKey
    if (!targetDate) return
    setDateStr(targetDate)
  }, [popupStartKey, popupEndKey, displayTz, setDateStr])

  const [visibility, setVisibility] = useState<Visibility>("public")
  const [maxParticipants, setMaxParticipants] = useState("")
  const [meetingUrl, setMeetingUrl] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [trackId, setTrackId] = useState<string>("")
  const [coverUrl, setCoverUrl] = useState("")

  // ---- venue + availability ------------------------------------------
  const {
    venues,
    selectedVenue,
    isVenueClosedOnDay,
    selectedDateIsClosed,
    startOptions,
    nearbyStartOptions,
    withinOpenHours,
    availability,
    availabilityData,
  } = useVenueAvailability({
    popupId,
    venueId,
    dateStr,
    displayTz,
    startIso,
    endIso,
    durationMinutes,
    isDateOutsidePopupWindow,
    popupStartKey,
    setDateStr,
    setTimeStr,
  })

  // ---- tracks --------------------------------------------------------
  const { data: tracksData } = useQuery({
    queryKey: ["portal-tracks", popupId],
    queryFn: () =>
      TracksService.listPortalTracks({ popupId: popupId!, limit: 200 }),
    enabled: !!popupId,
  })
  const tracks: TrackPublic[] = tracksData?.results ?? []

  // ---- mutation -------------------------------------------------------
  const createMutation = useMutation({
    mutationFn: () => {
      if (!popupId) throw new Error(t("events.form.no_popup_error"))
      return EventsService.createPortalEvent({
        requestBody: {
          popup_id: popupId,
          title,
          content: content || null,
          start_time: startIso,
          end_time: endIso,
          timezone: timezone || "UTC",
          venue_id: venueId || null,
          track_id: trackId || null,
          visibility,
          max_participant: maxParticipants
            ? Math.max(0, parseInt(maxParticipants, 10))
            : null,
          meeting_url: meetingUrl || null,
          cover_url: coverUrl || null,
          tags,
          status: "published",
        },
      })
    },
    onSuccess: (event) => {
      const messageKey =
        event.status === "pending_approval"
          ? "events.form.event_created_pending_approval_success"
          : "events.form.event_created_success"
      toast.success(t(messageKey))
      router.push(`/portal/${city?.slug}/events/${event.id}`)
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError
          ? typeof err.body === "object" && err.body !== null
            ? String((err.body as { detail?: string }).detail ?? err.message)
            : err.message
          : (err as Error).message
      toast.error(msg)
    },
  })

  // Local object URL of the picture the user just chose. While set, the
  // cropper dialog is open and nothing has been uploaded yet.
  const [pendingCrop, setPendingCrop] = useState<{
    url: string
    name: string
  } | null>(null)

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

  const venueMaxCapacity = selectedVenue?.capacity ?? null
  const exceedsCapacity =
    venueMaxCapacity != null &&
    maxParticipants !== "" &&
    parseInt(maxParticipants, 10) > venueMaxCapacity

  // ---- gates ----------------------------------------------------------
  if (settingsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }
  if (!eventsEnabled) {
    return (
      <GatedMessage
        title={t("events.list.events_disabled_heading")}
        message={t("events.list.events_disabled_message", {
          cityName: city?.name ?? "",
        })}
      />
    )
  }
  if (!canCreate) {
    return (
      <GatedMessage
        title={t("events.form.creation_restricted_heading")}
        message={t("events.form.creation_restricted_message")}
      />
    )
  }

  const canSubmit =
    !!title.trim() &&
    !!startIso &&
    !!endIso &&
    (!venueId || withinOpenHours) &&
    availability !== "conflict" &&
    availability !== "checking" &&
    !createMutation.isPending

  const venueDisabled = selectedVenue?.booking_mode === "unbookable"

  return (
    <div className="flex flex-col max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
      <Link
        href={`/portal/${city?.slug}/events`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {t("events.common.back_to_events")}
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("events.form.create_heading")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {timezone
            ? t("events.form.create_subheading_with_tz", {
                cityName: city?.name ?? "",
                timezone,
              })
            : t("events.form.create_subheading", {
                cityName: city?.name ?? "",
              })}
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (canSubmit) createMutation.mutate()
        }}
        className="space-y-5"
      >
        <EventVenueField
          venueId={venueId}
          onVenueChange={setVenueId}
          venues={venues}
          selectedVenue={selectedVenue}
          selectedDateIsClosed={selectedDateIsClosed}
        />

        {/* Title */}
        <div className="space-y-2">
          <Label htmlFor="title">{t("events.form.title_label")}</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("events.form.title_placeholder")}
            required
          />
        </div>

        {/* Cover image */}
        <div className="space-y-2">
          <Label>{t("events.form.cover_image_label")}</Label>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={(e) => {
              onPickFile(e.target.files)
              // Allow picking the same file again after cancelling the crop.
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
                  <Upload className="mr-1 h-4 w-4" />
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
            <div>
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
                  ? t("events.form.uploading_button")
                  : t("events.form.upload_image_button")}
              </Button>
              <p className="text-xs text-muted-foreground mt-1">
                {t("events.form.cover_fallback_note")}
              </p>
            </div>
          )}
        </div>

        <EventScheduleFields
          dateStr={dateStr}
          onDateChange={setDateStr}
          isDateOutsidePopupWindow={isDateOutsidePopupWindow}
          isVenueClosedOnDay={isVenueClosedOnDay}
          popupWindowLabel={popupWindowLabel}
          timeStr={timeStr}
          onTimeChange={setTimeStr}
          durationValue={durationValue}
          durationUnit={durationUnit}
          onDurationChange={(next) => {
            setDurationValue(next.value)
            setDurationUnit(next.unit)
          }}
          venueId={venueId}
          withinOpenHours={withinOpenHours}
          availability={availability}
          availabilityLoaded={!!availabilityData}
          startOptionsCount={startOptions.length}
          nearbyStartOptions={nearbyStartOptions}
          onSuggestionPick={setTimeStr}
          disabled={venueDisabled}
        />

        {/* Visibility */}
        <div className="space-y-2">
          <Label htmlFor="visibility">
            {t("events.form.visibility_label")}
          </Label>
          <Select
            value={visibility}
            onValueChange={(v) => setVisibility(v as Visibility)}
          >
            <SelectTrigger id="visibility" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="public">
                {t("events.form.visibility_public")}
              </SelectItem>
              <SelectItem value="private">
                {t("events.form.visibility_private")}
              </SelectItem>
              <SelectItem value="unlisted">
                {t("events.form.visibility_unlisted")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="content">{t("events.form.description_label")}</Label>
          <Textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t("events.form.description_placeholder")}
            rows={4}
          />
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
            placeholder={
              venueMaxCapacity != null
                ? t("events.form.max_participants_placeholder_capacity", {
                    capacity: venueMaxCapacity,
                  })
                : t("events.form.max_participants_placeholder_unlimited")
            }
          />
          {exceedsCapacity && (
            <p className="text-xs text-destructive">
              {t("events.form.exceeds_capacity_warning", {
                capacity: venueMaxCapacity ?? 0,
              })}
            </p>
          )}
        </div>

        {/* Topic tags — restricted to the admin-curated list */}
        <div className="space-y-2">
          <Label>{t("events.form.topic_label")}</Label>
          {settings?.allowed_tags && settings.allowed_tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {settings.allowed_tags.map((tag) => {
                const active = tags.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      if (active) setTags(tags.filter((x) => x !== tag))
                      else setTags([...tags, tag])
                    }}
                    className={
                      active
                        ? "inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-xs text-primary-foreground"
                        : "inline-flex items-center gap-1 rounded-full border border-input bg-background px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                    }
                  >
                    {tag}
                    {active && <X className="h-3 w-3" />}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("events.form.no_tags_configured")}
            </p>
          )}
        </div>

        {/* Track */}
        {tracks.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="track">{t("events.form.track_label")}</Label>
            <Select
              value={trackId || "__none__"}
              onValueChange={(v) => setTrackId(v === "__none__" ? "" : v)}
            >
              <SelectTrigger id="track" className="w-full">
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

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/portal/${city?.slug}/events`)}
          >
            {t("events.form.cancel_button")}
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {createMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            {t("events.form.create_button")}
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

function GatedMessage({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center max-w-md mx-auto">
      <ImageIcon className="h-10 w-10 text-muted-foreground/50 mb-3" />
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground mt-2">{message}</p>
    </div>
  )
}
