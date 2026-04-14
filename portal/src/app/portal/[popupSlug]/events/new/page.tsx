"use client"

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

import {
  ApiError,
  EventsService,
  EventSettingsService,
  EventVenuesService,
  type EventVenuePublic,
  TracksService,
  type TrackPublic,
} from "@/client"
import { Badge } from "@/components/ui/badge"
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
import { toast } from "sonner"
import { useEventTimezone } from "../lib/useEventTimezone"
import { useFileUpload } from "../lib/useFileUpload"
import {
  availableEndOptions,
  availableStartOptions,
  dayBoundsInTz,
  freeIntervalsForDay,
} from "../lib/venue-slots"

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

type Visibility = "public" | "private" | "unlisted"

export default function NewPortalEventPage() {
  const router = useRouter()
  const { getCity } = useCityProvider()
  const city = getCity()
  const popupId = city?.id
  const { timezone } = useEventTimezone(popupId)
  const { uploadFile, isUploading } = useFileUpload()
  const fileRef = useRef<HTMLInputElement>(null)

  // ---- settings-driven gates ------------------------------------------
  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["portal-event-settings", popupId],
    queryFn: () =>
      EventSettingsService.getPortalEventSettings({ popupId: popupId! }),
    enabled: !!popupId,
  })
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
  const defaultEnd = useMemo(() => {
    const d = new Date(defaultStart)
    d.setHours(d.getHours() + 1)
    return d
  }, [defaultStart])

  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [venueId, setVenueId] = useState<string>("")
  // Date picked by the user, "YYYY-MM-DD" in the popup's configured TZ.
  const [dateStr, setDateStr] = useState(() => todayInTz(displayTz))
  // Times as absolute UTC ISO strings (chosen from slot dropdowns when a
  // venue is selected, or derived from <input type="datetime-local"> when
  // no venue is selected).
  const [startIso, setStartIso] = useState<string>(defaultStart.toISOString())
  const [endIso, setEndIso] = useState<string>(defaultEnd.toISOString())
  const [visibility, setVisibility] = useState<Visibility>("public")
  const [maxParticipants, setMaxParticipants] = useState("")
  const [meetingUrl, setMeetingUrl] = useState("")
  const [tagDraft, setTagDraft] = useState("")
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
    () => availableStartOptions(freeIntervals, 30, displayTz),
    [freeIntervals, displayTz],
  )
  const endOptions = useMemo(() => {
    if (!startIso) return []
    return availableEndOptions(
      freeIntervals,
      Date.parse(startIso),
      30,
      displayTz,
    )
  }, [freeIntervals, startIso, displayTz])

  // If the chosen start is no longer valid after venue/date changes, clear.
  useEffect(() => {
    if (!venueId) return
    if (!startIso) return
    const still = startOptions.some((o) => o.isoUtc === startIso)
    if (!still) {
      setStartIso("")
      setEndIso("")
    }
  }, [venueId, dateStr, startOptions, startIso])
  useEffect(() => {
    if (!venueId || !startIso || !endIso) return
    const still = endOptions.some((o) => o.isoUtc === endIso)
    if (!still) setEndIso("")
  }, [venueId, dateStr, endOptions, startIso, endIso])

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
          ? (typeof err.body === "object" && err.body !== null
              ? String(
                  (err.body as { detail?: string }).detail ?? err.message,
                )
              : err.message)
          : (err as Error).message
      toast.error(msg)
    },
  })

  // ---- handlers -------------------------------------------------------
  const addTag = (raw: string) => {
    const t = raw.trim().toLowerCase()
    if (!t || tags.includes(t)) {
      setTagDraft("")
      return
    }
    setTags([...tags, t])
    setTagDraft("")
  }

  const removeTag = (idx: number) => {
    const next = tags.slice()
    next.splice(idx, 1)
    setTags(next)
  }

  const onPickFile = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    try {
      const { publicUrl } = await uploadFile(files[0])
      setCoverUrl(publicUrl)
      toast.success("Image uploaded")
    } catch (err) {
      toast.error((err as Error).message)
    }
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
            <div className="text-xs text-muted-foreground space-y-0.5">
              {selectedVenue.booking_mode === "unbookable" && (
                <p className="text-destructive">
                  This venue is not bookable.
                </p>
              )}
              {selectedVenue.booking_mode === "approval_required" && (
                <p>This venue requires admin approval for new events.</p>
              )}
              {(selectedVenue.setup_time_minutes ?? 0) > 0 ||
              (selectedVenue.teardown_time_minutes ?? 0) > 0 ? (
                <p>
                  Locked {selectedVenue.setup_time_minutes ?? 0}m before
                  start and {selectedVenue.teardown_time_minutes ?? 0}m
                  after end for setup/teardown.
                </p>
              ) : null}
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

        {/* Date */}
        <div className="space-y-2">
          <Label htmlFor="date">Date</Label>
          <Input
            id="date"
            type="date"
            value={dateStr}
            onChange={(e) => {
              setDateStr(e.target.value)
              setStartIso("")
              setEndIso("")
            }}
            disabled={selectedVenue?.booking_mode === "unbookable"}
            required
          />
        </div>

        {/* Times */}
        {venueId ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="start">Start time</Label>
              <Select
                value={startIso || ""}
                onValueChange={(v) => {
                  setStartIso(v)
                  setEndIso("")
                }}
                disabled={
                  selectedVenue?.booking_mode === "unbookable" ||
                  startOptions.length === 0
                }
              >
                <SelectTrigger id="start" className="w-full">
                  <SelectValue
                    placeholder={
                      startOptions.length === 0
                        ? "No open hours"
                        : "Pick a start"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {startOptions.map((o) => (
                    <SelectItem key={o.isoUtc} value={o.isoUtc}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="end">End time</Label>
              <Select
                value={endIso || ""}
                onValueChange={setEndIso}
                disabled={!startIso || endOptions.length === 0}
              >
                <SelectTrigger id="end" className="w-full">
                  <SelectValue
                    placeholder={
                      !startIso
                        ? "Pick a start first"
                        : endOptions.length === 0
                          ? "No valid ends"
                          : "Pick an end"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {endOptions.map((o) => (
                    <SelectItem key={o.isoUtc} value={o.isoUtc}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                onChange={(e) =>
                  setStartIso(localInputToIso(e.target.value))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end">End</Label>
              <Input
                id="end"
                type="datetime-local"
                value={endIso ? toLocalInput(new Date(endIso)) : ""}
                onChange={(e) => setEndIso(localInputToIso(e.target.value))}
                required
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
              Exceeds venue capacity ({venueMaxCapacity}). Extra attendees
              will still be allowed.
            </p>
          )}
        </div>

        {/* Topic tags */}
        <div className="space-y-2">
          <Label htmlFor="tags">Topic</Label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-2 py-1.5 focus-within:ring-[3px] focus-within:ring-ring/50 focus-within:border-ring">
            {tags.map((t, i) => (
              <span
                key={`${t}-${i}`}
                className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
              >
                {t}
                <button
                  type="button"
                  onClick={() => removeTag(i)}
                  aria-label={`Remove ${t}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <input
              id="tags"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
                  if (tagDraft.trim()) {
                    e.preventDefault()
                    addTag(tagDraft)
                  }
                } else if (
                  e.key === "Backspace" &&
                  !tagDraft &&
                  tags.length > 0
                ) {
                  e.preventDefault()
                  removeTag(tags.length - 1)
                }
              }}
              onBlur={() => tagDraft.trim() && addTag(tagDraft)}
              placeholder={tags.length === 0 ? "Add tag..." : ""}
              className="flex-1 min-w-[80px] border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
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

        {/* Cover image */}
        <div className="space-y-2">
          <Label>Cover image (optional)</Label>
          {coverUrl ? (
            <div className="relative w-full max-w-sm overflow-hidden rounded-lg border">
              <img
                src={coverUrl}
                alt="Event cover"
                className="w-full h-40 object-cover"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="absolute top-2 right-2"
                onClick={() => setCoverUrl("")}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={(e) => onPickFile(e.target.files)}
              />
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
