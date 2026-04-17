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
  CheckCircle,
  CircleAlert,
  Image as ImageIcon,
  Loader2,
  Plus,
  Upload,
  X,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
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

/** "YYYY-MM-DDTHH:mm" local form expected by <input type="datetime-local">. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function localInputToIso(local: string): string {
  if (!local) return ""
  return new Date(local).toISOString()
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
  const router = useRouter()
  const { getCity } = useCityProvider()
  const city = getCity()
  const popupId = city?.id
  const { timezone } = useEventTimezone(popupId)
  const { uploadFile, isUploading } = useFileUpload()
  const fileRef = useRef<HTMLInputElement>(null)

  // ---- settings-driven gates ------------------------------------------
  const { data: settings, isLoading: settingsLoading } =
    usePortalEventSettings(popupId)
  const eventsEnabled = settings?.event_enabled ?? false
  const canPublish = settings?.can_publish_event === "everyone"

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
  // Start time as an absolute UTC ISO string. When the user has a venue
  // selected we derive this from the picked date + typed/suggested HH:mm;
  // without a venue we fall back to a <datetime-local> input.
  const [startIso, setStartIso] = useState<string>(defaultStart.toISOString())
  // Typed "HH:mm" (in displayTz) for the venue-backed time picker. Kept in
  // sync with startIso but also allows custom values typed by the user.
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
  const [durationValue, setDurationValue] = useState<number>(60)
  const [durationUnit, setDurationUnit] = useState<DurationUnit>("minutes")
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

  // True when the picked date falls on a weekday the venue is closed. HTML
  // date inputs don't support day-level disabling, so we surface a warning
  // and let the user correct it before submitting.
  const selectedDateIsClosed = useMemo(() => {
    if (!selectedVenue?.weekly_hours || !dateStr) return false
    // dateStr is YYYY-MM-DD in display tz. Parse as local date.
    const [y, m, d] = dateStr.split("-").map(Number)
    if (!y || !m || !d) return false
    const jsDay = new Date(y, m - 1, d).getDay() // 0=Sun..6=Sat
    const backendDay = (jsDay + 6) % 7 // 0=Mon..6=Sun
    const entry = selectedVenue.weekly_hours.find(
      (h) => h.day_of_week === backendDay,
    )
    return !entry || entry.is_closed
  }, [selectedVenue, dateStr])

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

  // End ISO derived from startIso + duration.
  const endIso = useMemo(() => {
    if (!startIso) return ""
    const start = Date.parse(startIso)
    if (Number.isNaN(start)) return ""
    return new Date(start + durationMinutes * 60_000).toISOString()
  }, [startIso, durationMinutes])

  // Does the typed start + duration fit in a free interval?
  const startFits = useMemo(() => {
    if (!venueId) return true
    if (!startIso) return true
    if (freeIntervals.length === 0) return true
    const ms = Date.parse(startIso)
    if (Number.isNaN(ms)) return true
    return durationFits(freeIntervals, ms, durationMinutes)
  }, [venueId, startIso, freeIntervals, durationMinutes])

  // ---- final availability check (used even when there's no venue) ----
  const [availability, setAvailability] = useState<
    | { state: "idle" | "checking" }
    | { state: "ok" }
    | { state: "conflict"; reason: string | null }
  >({ state: "idle" })

  useEffect(() => {
    if (!venueId || !startIso || !endIso) {
      setAvailability({ state: "idle" })
      return
    }
    const handle = setTimeout(async () => {
      setAvailability({ state: "checking" })
      try {
        const res = await EventsService.checkAvailability({
          requestBody: {
            venue_id: venueId,
            start_time: startIso,
            end_time: endIso,
          },
        })
        if (res.available) {
          setAvailability({ state: "ok" })
        } else {
          setAvailability({
            state: "conflict",
            reason: res.reason ?? "Conflicts with another event",
          })
        }
      } catch {
        setAvailability({ state: "idle" })
      }
    }, 500)
    return () => clearTimeout(handle)
  }, [venueId, startIso, endIso])

  // ---- mutation -------------------------------------------------------
  const createMutation = useMutation({
    mutationFn: () => {
      if (!popupId) throw new Error("No popup")
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
      toast.success("Event created")
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
      toast.success("Image uploaded")
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
        title="Events are disabled"
        message={`The organizer has turned off events for ${city?.name}.`}
      />
    )
  }
  if (!canPublish) {
    return (
      <GatedMessage
        title="Event creation is restricted"
        message="Only admins can publish events for this pop-up."
      />
    )
  }

  const canSubmit =
    !!title.trim() && !!startIso && !!endIso && !createMutation.isPending

  return (
    <div className="flex flex-col max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
      <Link
        href={`/portal/${city?.slug}/events`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to events
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Create event</h1>
        <p className="text-sm text-muted-foreground mt-1">
          New event at {city?.name}
          {timezone ? ` — times in ${timezone}` : ""}
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
          <Label>Venue</Label>
          <Select
            value={venueId || "__none__"}
            onValueChange={(v) => setVenueId(v === "__none__" ? "" : v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="No venue" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No venue</SelectItem>
              {venues.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.title || "Untitled venue"}
                  {v.capacity ? ` (cap. ${v.capacity})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedVenue && (
            <div className="text-xs text-muted-foreground space-y-2">
              <VenueHoursSummary hours={selectedVenue.weekly_hours} />
              {selectedVenue.booking_mode === "unbookable" && (
                <p className="text-destructive">This venue is not bookable.</p>
              )}
              {selectedVenue.booking_mode === "approval_required" && (
                <p>This venue requires admin approval for new events.</p>
              )}
              {(selectedVenue.setup_time_minutes ?? 0) > 0 ||
              (selectedVenue.teardown_time_minutes ?? 0) > 0 ? (
                <p>
                  Locked {selectedVenue.setup_time_minutes ?? 0}m before start
                  and {selectedVenue.teardown_time_minutes ?? 0}m after end for
                  setup/teardown.
                </p>
              ) : null}
              {selectedDateIsClosed && (
                <p className="text-yellow-600 dark:text-yellow-500">
                  The selected date falls on a day the venue is closed.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Title */}
        <div className="space-y-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Event name"
            required
          />
        </div>

        {/* Cover image */}
        <div className="space-y-2">
          <Label>Cover image (optional)</Label>
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
                alt="Event cover"
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
                  Replace
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
                {isUploading ? "Uploading…" : "Upload image"}
              </Button>
              <p className="text-xs text-muted-foreground mt-1">
                Leave empty to fall back to the venue&apos;s main photo.
              </p>
            </div>
          )}
        </div>

        {/* Date */}
        <div className="space-y-2">
          <Label htmlFor="date">Date</Label>
          <DatePicker
            id="date"
            value={dateStr}
            onChange={(newDate) => {
              setDateStr(newDate)
              if (venueId && timeStr) {
                const ms = combineDateTimeInTz(newDate, timeStr, displayTz)
                setStartIso(Number.isNaN(ms) ? "" : new Date(ms).toISOString())
              } else {
                setStartIso("")
              }
            }}
            disabled={selectedVenue?.booking_mode === "unbookable"}
          />
        </div>

        {/* Times + duration */}
        {venueId ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="start">Start time</Label>
              <StartTimeCombobox
                id="start"
                value={timeStr}
                onChange={(hhmm) => {
                  setTimeStr(hhmm)
                  if (!hhmm) {
                    setStartIso("")
                    return
                  }
                  const ms = combineDateTimeInTz(dateStr, hhmm, displayTz)
                  setStartIso(
                    Number.isNaN(ms) ? "" : new Date(ms).toISOString(),
                  )
                }}
                options={startOptions}
                disabled={selectedVenue?.booking_mode === "unbookable"}
                fits={startFits}
                placeholder={
                  startOptions.length === 0 ? "No open hours" : "HH:mm"
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Duration</Label>
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
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="start">Start</Label>
              <Input
                id="start"
                type="datetime-local"
                value={startIso ? toLocalInput(new Date(startIso)) : ""}
                onChange={(e) => setStartIso(localInputToIso(e.target.value))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Duration</Label>
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
        )}
        {venueId && startOptions.length === 0 && availabilityData && (
          <p className="text-xs text-muted-foreground">
            Venue has no open hours on this day (check weekly hours or
            exceptions).
          </p>
        )}
        {availability.state === "checking" && (
          <p className="text-xs text-muted-foreground">
            Checking availability…
          </p>
        )}
        {availability.state === "ok" && (
          <p className="text-xs text-green-600 inline-flex items-center gap-1">
            <CheckCircle className="h-3.5 w-3.5" /> Slot available
          </p>
        )}
        {availability.state === "conflict" && (
          <p className="text-xs text-destructive inline-flex items-center gap-1">
            <CircleAlert className="h-3.5 w-3.5" /> {availability.reason}
          </p>
        )}

        {/* Visibility */}
        <div className="space-y-2">
          <Label htmlFor="visibility">Visibility</Label>
          <Select
            value={visibility}
            onValueChange={(v) => setVisibility(v as Visibility)}
          >
            <SelectTrigger id="visibility" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="public">Public</SelectItem>
              <SelectItem value="private">Private (invitees only)</SelectItem>
              <SelectItem value="unlisted">
                Unlisted (hidden, shareable link)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="content">Description (optional)</Label>
          <Textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What the event is about"
            rows={4}
          />
        </div>

        {/* Max participants */}
        <div className="space-y-2">
          <Label htmlFor="max">Max participants (optional)</Label>
          <Input
            id="max"
            type="number"
            min={0}
            value={maxParticipants}
            onChange={(e) => setMaxParticipants(e.target.value)}
            placeholder={
              venueMaxCapacity != null
                ? `Venue capacity: ${venueMaxCapacity}`
                : "Unlimited"
            }
          />
          {exceedsCapacity && (
            <p className="text-xs text-yellow-600">
              Exceeds venue capacity ({venueMaxCapacity}). Extra attendees will
              still be allowed.
            </p>
          )}
        </div>

        {/* Topic tags — restricted to the admin-curated list */}
        <div className="space-y-2">
          <Label>Topic</Label>
          {settings?.allowed_tags && settings.allowed_tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {settings.allowed_tags.map((t) => {
                const active = tags.includes(t)
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      if (active) setTags(tags.filter((x) => x !== t))
                      else setTags([...tags, t])
                    }}
                    className={
                      active
                        ? "inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-xs text-primary-foreground"
                        : "inline-flex items-center gap-1 rounded-full border border-input bg-background px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                    }
                  >
                    {t}
                    {active && <X className="h-3 w-3" />}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Tags for this pop-up are not configured. Ask an admin to set them
              in Event Settings.
            </p>
          )}
        </div>

        {/* Track */}
        {tracks.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="track">Track (optional)</Label>
            <Select
              value={trackId || "__none__"}
              onValueChange={(v) => setTrackId(v === "__none__" ? "" : v)}
            >
              <SelectTrigger id="track" className="w-full">
                <SelectValue placeholder="No track" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No track</SelectItem>
                {tracks.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Meeting URL */}
        <div className="space-y-2">
          <Label htmlFor="meeting">Meeting URL (optional)</Label>
          <Input
            id="meeting"
            type="url"
            value={meetingUrl}
            onChange={(e) => setMeetingUrl(e.target.value)}
            placeholder="https://…"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/portal/${city?.slug}/events`)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {createMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Create event
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

interface StartTimeComboboxProps {
  id?: string
  value: string // "HH:mm"
  onChange: (hhmm: string) => void
  options: { label: string; isoUtc: string }[]
  disabled?: boolean
  fits: boolean
  placeholder?: string
}

function StartTimeCombobox({
  id,
  value,
  onChange,
  options,
  disabled,
  fits,
  placeholder,
}: StartTimeComboboxProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="w-full">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Input
            id={id}
            type="time"
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            onFocus={() => {
              if (options.length > 0) setOpen(true)
            }}
            onChange={(e) => {
              const raw = e.target.value
              onChange(raw ? raw.slice(0, 5) : "")
            }}
            className={cn(
              "w-full",
              !fits && value
                ? "border-destructive focus-visible:ring-destructive/40"
                : "",
            )}
          />
        </PopoverTrigger>
        {options.length > 0 && (
          <PopoverContent
            align="start"
            className="w-[220px] p-1"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Suggested slots
            </p>
            <ul className="max-h-60 overflow-y-auto">
              {options.map((o) => (
                <li key={o.isoUtc}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                      value === o.label
                        ? "bg-accent text-accent-foreground"
                        : "",
                    )}
                    onClick={() => {
                      onChange(o.label)
                      setOpen(false)
                    }}
                  >
                    <span>{o.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        )}
      </Popover>
      {!fits && value && (
        <p className="mt-1 text-xs text-destructive">
          Not available — overlaps busy
        </p>
      )}
    </div>
  )
}

interface DurationPickerProps {
  value: number
  unit: DurationUnit
  onChange: (next: { value: number; unit: DurationUnit }) => void
}

function DurationPicker({ value, unit, onChange }: DurationPickerProps) {
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
          <SelectItem value="minutes">Minutes</SelectItem>
          <SelectItem value="hours">Hours</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
