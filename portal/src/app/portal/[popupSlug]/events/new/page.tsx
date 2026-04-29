"use client"

import {
  availableStartOptionsForDuration,
  dayBoundsInTz,
  durationFits,
  freeIntervalsForDay,
} from "@edgeos/shared-events"
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
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import {
  ApiError,
  EventsService,
  type EventVenuePublic,
  EventVenuesService,
  type TrackPublic,
  TracksService,
} from "@/client"
import { CoverImageCropper } from "@/components/CoverImageCropper"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
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
import { cn } from "@/lib/utils"
import { useCityProvider } from "@/providers/cityProvider"
import {
  useEventTimezone,
  usePortalEventSettings,
} from "../lib/useEventTimezone"
import { useFileUpload } from "../lib/useFileUpload"

/** "YYYY-MM-DD" of today in the given TZ (used as initial date picker value). */
function todayInTz(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

/**
 * Convert a "YYYY-MM-DD" date + "HH:mm" time (interpreted in `tz`) to a UTC
 * instant (ms since epoch). Returns NaN if invalid.
 */
function combineDateTimeInTz(
  dateStr: string,
  hhmm: string,
  tz: string,
): number {
  if (!dateStr || !hhmm) return Number.NaN
  const [y, mo, d] = dateStr.split("-").map(Number)
  const [h, mi] = hhmm.split(":").map(Number)
  if ([y, mo, d, h, mi].some((n) => Number.isNaN(n))) return Number.NaN
  // Build a UTC guess and subtract the tz offset at that moment.
  const guess = Date.UTC(y, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, 0)
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(guess))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") === 24 ? 0 : get("hour"),
    get("minute"),
    get("second"),
  )
  const offsetMin = Math.round((asUtc - guess) / 60000)
  return guess - offsetMin * 60_000
}

type Visibility = "public" | "private" | "unlisted"
type DurationUnit = "minutes" | "hours"

export default function NewPortalEventPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const { getCity } = useCityProvider()
  const city = getCity()
  const popupId = city?.id
  const { timezone } = useEventTimezone(popupId)

  // Popup booking window. start_date/end_date come from the popup record
  // (stored in UTC) and the portal restricts event creation to dates
  // inside that range. We compare on the wall-clock date string (first 10
  // chars of the ISO) to avoid surprising tz-boundary off-by-ones at the
  // UI level — the backend re-checks the full timestamp on submit.
  const popupStartKey = city?.start_date ? city.start_date.slice(0, 10) : null
  const popupEndKey = city?.end_date ? city.end_date.slice(0, 10) : null
  const isDateOutsidePopupWindow = useMemo(() => {
    if (!popupStartKey && !popupEndKey) return () => false
    return (d: Date) => {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, "0")
      const day = String(d.getDate()).padStart(2, "0")
      const key = `${y}-${m}-${day}`
      if (popupStartKey && key < popupStartKey) return true
      if (popupEndKey && key > popupEndKey) return true
      return false
    }
  }, [popupStartKey, popupEndKey])
  const popupWindowLabel = useMemo(() => {
    if (!popupStartKey && !popupEndKey) return null
    const fmt = (key: string) =>
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(`${key}T00:00:00`))
    if (popupStartKey && popupEndKey)
      return `${fmt(popupStartKey)} – ${fmt(popupEndKey)}`
    if (popupStartKey) return `from ${fmt(popupStartKey)}`
    return `until ${fmt(popupEndKey!)}`
  }, [popupStartKey, popupEndKey])
  const { uploadFile, isUploading } = useFileUpload()
  const fileRef = useRef<HTMLInputElement>(null)

  // ---- settings-driven gates ------------------------------------------
  const { data: settings, isLoading: settingsLoading } =
    usePortalEventSettings(popupId)
  const eventsEnabled = settings?.event_enabled ?? true
  const canCreate = (settings?.can_publish_event ?? "everyone") === "everyone"

  // ---- form state -----------------------------------------------------
  const displayTz = timezone || "UTC"
  const now = useMemo(() => new Date(), [])
  const defaultStart = useMemo(() => {
    const d = new Date(now)
    d.setMinutes(0, 0, 0)
    d.setHours(d.getHours() + 2)
    return d
  }, [now])

  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [venueId, setVenueId] = useState<string>("")
  // Date picked by the user, "YYYY-MM-DD" in the popup's configured TZ.
  const [dateStr, setDateStr] = useState(() => todayInTz(displayTz))
  // "HH:mm" in displayTz. The single source of truth for the start time —
  // startIso is derived below from dateStr + timeStr.
  const [timeStr, setTimeStr] = useState<string>(() => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: displayTz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(defaultStart)
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
    return `${get("hour")}:${get("minute")}`
  })
  const startIso = useMemo(() => {
    if (!dateStr || !timeStr) return ""
    const ms = combineDateTimeInTz(dateStr, timeStr, displayTz)
    return Number.isNaN(ms) ? "" : new Date(ms).toISOString()
  }, [dateStr, timeStr, displayTz])
  const [durationValue, setDurationValue] = useState<number>(60)
  const [durationUnit, setDurationUnit] = useState<DurationUnit>("minutes")

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
  }, [popupStartKey, popupEndKey, displayTz])

  const durationMinutes = Math.max(
    1,
    Math.round(durationUnit === "hours" ? durationValue * 60 : durationValue),
  )
  const [visibility, setVisibility] = useState<Visibility>("public")
  const [maxParticipants, setMaxParticipants] = useState("")
  const [meetingUrl, setMeetingUrl] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [trackId, setTrackId] = useState<string>("")
  const [coverUrl, setCoverUrl] = useState("")

  // ---- data -----------------------------------------------------------
  const { data: venuesData } = useQuery({
    queryKey: ["portal-event-venues", popupId],
    queryFn: () =>
      EventVenuesService.listPortalVenues({ popupId: popupId!, limit: 200 }),
    enabled: !!popupId,
  })
  const venues = venuesData?.results ?? []
  const selectedVenue: EventVenuePublic | undefined = venues.find(
    (v) => v.id === venueId,
  )

  // Day-level matcher used by both the warning text and the date picker:
  // returns true when the venue is closed on the given date. Mirrors the
  // backend's `_compute_availability` rule that a venue with *no*
  // weekly_hours rows is always-open.
  const isVenueClosedOnDay = useMemo(() => {
    const hours = selectedVenue?.weekly_hours
    if (!hours || hours.length === 0) return undefined
    const closedByBackendDay = new Map<number, boolean>()
    for (const h of hours) {
      closedByBackendDay.set(h.day_of_week, h.is_closed)
    }
    return (date: Date) => {
      const backendDay = (date.getDay() + 6) % 7 // JS 0=Sun..6=Sat → BE 0=Mon..6=Sun
      const isClosed = closedByBackendDay.get(backendDay)
      return isClosed === undefined || isClosed === true
    }
  }, [selectedVenue])

  const selectedDateIsClosed = useMemo(() => {
    if (!isVenueClosedOnDay || !dateStr) return false
    const [y, m, d] = dateStr.split("-").map(Number)
    if (!y || !m || !d) return false
    return isVenueClosedOnDay(new Date(y, m - 1, d))
  }, [isVenueClosedOnDay, dateStr])

  // When the venue changes (or one is picked for the first time), if the
  // currently selected date is closed at the new venue, jump forward to
  // the first open day inside the popup window. Driven off venueId via a
  // ref so other deps (matcher refs, dateStr) don't re-trigger the snap.
  const prevVenueIdRef = useRef(venueId)
  useEffect(() => {
    if (prevVenueIdRef.current === venueId) return
    prevVenueIdRef.current = venueId
    if (!isVenueClosedOnDay || !dateStr) return
    const [y, m, d] = dateStr.split("-").map(Number)
    if (!y || !m || !d) return
    if (!isVenueClosedOnDay(new Date(y, m - 1, d))) return // current day still works
    // Walk forward from max(today, popupStart) until we find an open day,
    // bailing out once we leave the popup window.
    const todayKey = todayInTz(displayTz)
    const startKey =
      popupStartKey && popupStartKey > todayKey ? popupStartKey : todayKey
    const [sy, sm, sd] = startKey.split("-").map(Number)
    if (!sy || !sm || !sd) return
    const cursor = new Date(sy, sm - 1, sd)
    for (let i = 0; i < 400; i++) {
      if (isDateOutsidePopupWindow(cursor)) return
      if (!isVenueClosedOnDay(cursor)) {
        const yy = cursor.getFullYear()
        const mm = String(cursor.getMonth() + 1).padStart(2, "0")
        const dd = String(cursor.getDate()).padStart(2, "0")
        setDateStr(`${yy}-${mm}-${dd}`)
        return
      }
      cursor.setDate(cursor.getDate() + 1)
    }
  }, [
    venueId,
    isVenueClosedOnDay,
    isDateOutsidePopupWindow,
    dateStr,
    displayTz,
    popupStartKey,
  ])

  const { data: tracksData } = useQuery({
    queryKey: ["portal-tracks", popupId],
    queryFn: () =>
      TracksService.listPortalTracks({ popupId: popupId!, limit: 200 }),
    enabled: !!popupId,
  })
  const tracks: TrackPublic[] = tracksData?.results ?? []

  // ---- venue availability for the selected date -----------------------
  const dayBounds = useMemo(() => {
    if (!dateStr) return null
    return dayBoundsInTz(dateStr, displayTz)
  }, [dateStr, displayTz])

  const { data: availabilityData } = useQuery({
    queryKey: [
      "portal-venue-availability",
      venueId,
      dayBounds?.start.toISOString(),
    ],
    queryFn: () =>
      EventVenuesService.getPortalAvailability({
        venueId: venueId!,
        start: dayBounds!.start.toISOString(),
        end: dayBounds!.end.toISOString(),
      }),
    enabled: !!venueId && !!dayBounds,
  })

  const freeIntervals = useMemo(() => {
    if (!availabilityData || !dayBounds) return []
    return freeIntervalsForDay(
      availabilityData.open_ranges,
      availabilityData.busy,
      dayBounds.start,
      dayBounds.end,
    )
  }, [availabilityData, dayBounds])

  // Same as freeIntervals but with busy-slot subtraction skipped — used to
  // distinguish "time falls outside the venue's open hours" from "venue is
  // open at this time but another event already occupies the slot".
  const openOnlyIntervals = useMemo(() => {
    if (!availabilityData || !dayBounds) return []
    return freeIntervalsForDay(
      availabilityData.open_ranges,
      [],
      dayBounds.start,
      dayBounds.end,
    )
  }, [availabilityData, dayBounds])

  const startOptions = useMemo(
    () =>
      availableStartOptionsForDuration(
        freeIntervals,
        durationMinutes,
        30,
        displayTz,
      ),
    [freeIntervals, durationMinutes, displayTz],
  )

  // When the user selects a venue, snap timeStr to the first available
  // slot once availability data has loaded. We snap once per venueId so
  // subsequent typing isn't overwritten — out-of-range times surface as
  // a validation error and block submit instead.
  const lastVenueSnapRef = useRef("")
  useEffect(() => {
    if (!venueId) {
      lastVenueSnapRef.current = ""
      return
    }
    if (lastVenueSnapRef.current === venueId) return
    if (startOptions.length === 0) return
    lastVenueSnapRef.current = venueId
    setTimeStr(startOptions[0].label)
  }, [venueId, startOptions])

  // End ISO derived from startIso + duration.
  const endIso = useMemo(() => {
    if (!startIso) return ""
    const start = Date.parse(startIso)
    if (Number.isNaN(start)) return ""
    return new Date(start + durationMinutes * 60_000).toISOString()
  }, [startIso, durationMinutes])

  // Does the typed start + duration fit inside the venue's open hours
  // (ignoring busy slots from other events)? Drives the inline "outside
  // open hours" error on the start-time input.
  const withinOpenHours = useMemo(() => {
    if (!venueId) return true
    if (!startIso) return true
    if (openOnlyIntervals.length === 0) return true
    const ms = Date.parse(startIso)
    if (Number.isNaN(ms)) return true
    return durationFits(openOnlyIntervals, ms, durationMinutes)
  }, [venueId, startIso, openOnlyIntervals, durationMinutes])

  // ---- final availability check (only renders the conflict signal now) --
  const [availability, setAvailability] = useState<
    "idle" | "checking" | "ok" | "conflict"
  >("idle")

  useEffect(() => {
    if (!venueId || !startIso || !endIso) {
      setAvailability("idle")
      return
    }
    const handle = setTimeout(async () => {
      setAvailability("checking")
      try {
        const res = await EventsService.checkAvailabilityPortal({
          requestBody: {
            venue_id: venueId,
            start_time: startIso,
            end_time: endIso,
          },
        })
        setAvailability(res.available ? "ok" : "conflict")
      } catch {
        setAvailability("idle")
      }
    }, 500)
    return () => clearTimeout(handle)
  }, [venueId, startIso, endIso])

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
      toast.success(t("events.form.event_created_success"))
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
                  {v.capacity
                    ? t("events.form.venue_capacity_suffix", {
                        capacity: v.capacity,
                      })
                    : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedVenue && (
            <div className="text-xs text-muted-foreground space-y-2">
              <VenueHoursSummary hours={selectedVenue.weekly_hours} />
              {selectedVenue.booking_mode === "unbookable" && (
                <p className="text-destructive">
                  {t("events.form.venue_not_bookable")}
                </p>
              )}
              {selectedVenue.booking_mode === "approval_required" && (
                <p>{t("events.form.venue_approval_required")}</p>
              )}
              {(selectedVenue.setup_time_minutes ?? 0) > 0 ||
              (selectedVenue.teardown_time_minutes ?? 0) > 0 ? (
                <p>
                  {t("events.form.venue_setup_teardown", {
                    setupTime: selectedVenue.setup_time_minutes ?? 0,
                    teardownTime: selectedVenue.teardown_time_minutes ?? 0,
                  })}
                </p>
              ) : null}
              {selectedDateIsClosed && (
                <p className="text-destructive">
                  {t("events.form.venue_closed_warning")}
                </p>
              )}
            </div>
          )}
        </div>

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

        {/* Date */}
        <div className="space-y-2">
          <Label htmlFor="date">{t("events.form.date_label")}</Label>
          <DatePicker
            id="date"
            value={dateStr}
            onChange={setDateStr}
            disabled={selectedVenue?.booking_mode === "unbookable"}
            disabledDays={isDateOutsidePopupWindow}
            closedDays={
              isVenueClosedOnDay
                ? (d) => !isDateOutsidePopupWindow(d) && isVenueClosedOnDay(d)
                : undefined
            }
          />
          {popupWindowLabel && (
            <p className="text-xs text-muted-foreground">
              {t("events.form.popup_window_hint", {
                window: popupWindowLabel,
              })}
            </p>
          )}
        </div>

        {/* Time + duration. Date lives in its own field above; this input
            is always HH:mm only (whether a venue is selected or not). */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="start">{t("events.form.start_time_label")}</Label>
              {availability === "checking" && (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              )}
            </div>
            <Input
              id="start"
              type="time"
              value={timeStr}
              disabled={selectedVenue?.booking_mode === "unbookable"}
              onChange={(e) => setTimeStr(e.target.value.slice(0, 5))}
              className={cn(
                "w-full",
                venueId &&
                  timeStr &&
                  (!withinOpenHours || availability === "conflict")
                  ? "border-destructive focus-visible:ring-destructive/40"
                  : "",
              )}
              required
            />
            {venueId && timeStr && !withinOpenHours && (
              <p className="text-xs text-destructive">
                {t("events.form.start_time_outside_venue_hours")}
              </p>
            )}
            {venueId &&
              timeStr &&
              withinOpenHours &&
              availability === "conflict" && (
                <p className="text-xs text-destructive">
                  There is already an event at this time.
                </p>
              )}
          </div>
          <div className="space-y-2">
            <Label>{t("events.form.duration_label")}</Label>
            <DurationPicker
              value={durationValue}
              unit={durationUnit}
              onChange={(next) => {
                setDurationValue(next.value)
                setDurationUnit(next.unit)
              }}
            />
          </div>
        </div>
        {venueId && startOptions.length === 0 && availabilityData && (
          <p className="text-xs text-destructive">
            {t("events.form.no_venue_open_hours")}
          </p>
        )}

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

interface DurationPickerProps {
  value: number
  unit: DurationUnit
  onChange: (next: { value: number; unit: DurationUnit }) => void
}

function DurationPicker({ value, unit, onChange }: DurationPickerProps) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={1}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          onChange({ value: Number.isNaN(n) ? 0 : n, unit })
        }}
        className="w-24"
      />
      <Select
        value={unit}
        onValueChange={(v) => {
          const next = v as DurationUnit
          if (next === unit) return
          const totalMinutes = unit === "hours" ? value * 60 : value
          onChange({
            unit: next,
            value:
              next === "hours"
                ? Math.max(1, Math.round(totalMinutes / 60))
                : Math.max(1, Math.round(totalMinutes)),
          })
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="minutes">{t("events.form.minutes")}</SelectItem>
          <SelectItem value="hours">{t("events.form.hours")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
