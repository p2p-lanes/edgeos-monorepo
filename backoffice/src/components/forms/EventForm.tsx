import { useForm, useStore } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Trash2, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  type EventCreate,
  type EventPublic,
  EventSettingsService,
  EventsService,
  EventVenuesService,
  type RecurrenceRule,
  TracksService,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DateTimePicker } from "@/components/ui/datetime-picker"
import { ImageUpload } from "@/components/ui/image-upload"
import {
  HeroInput,
  InlineRow,
  InlineSection,
} from "@/components/ui/inline-form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useCustomToast from "@/hooks/useCustomToast"
import { cn } from "@/lib/utils"
import {
  availableStartOptionsForDuration,
  dayBoundsInTz,
  durationFits,
  freeIntervalsForDay,
} from "@/lib/venue-slots"
import { createErrorHandler } from "@/utils"

interface EventFormProps {
  defaultValues?: EventPublic
  onSuccess: () => void
}

const EVENT_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
] as const

const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const
type WeekdayCode = (typeof WEEKDAY_CODES)[number]
const WEEKDAY_LABELS: Record<WeekdayCode, string> = {
  MO: "M",
  TU: "T",
  WE: "W",
  TH: "T",
  FR: "F",
  SA: "S",
  SU: "S",
}

type RepeatMode = "none" | "daily" | "weekly" | "monthly"
type RepeatEnd = "never" | "count" | "until"

interface RepeatState {
  mode: RepeatMode
  interval: number
  byDay: WeekdayCode[]
  end: RepeatEnd
  count: number
  until: string // YYYY-MM-DD
}

const DEFAULT_REPEAT: RepeatState = {
  mode: "none",
  interval: 1,
  byDay: [],
  end: "never",
  count: 10,
  until: "",
}

function parseRruleToState(rrule: string | null | undefined): RepeatState {
  if (!rrule) return { ...DEFAULT_REPEAT }
  const kv: Record<string, string> = {}
  for (const part of rrule.split(";")) {
    const [k, v] = part.split("=")
    if (k && v) kv[k.toUpperCase()] = v
  }
  const freq = kv.FREQ
  const mode: RepeatMode =
    freq === "DAILY"
      ? "daily"
      : freq === "WEEKLY"
        ? "weekly"
        : freq === "MONTHLY"
          ? "monthly"
          : "none"
  const interval = kv.INTERVAL ? parseInt(kv.INTERVAL) || 1 : 1
  const byDay =
    kv.BYDAY != null
      ? (kv.BYDAY.split(",")
          .map((c) => c.toUpperCase())
          .filter((c): c is WeekdayCode =>
            (WEEKDAY_CODES as readonly string[]).includes(c),
          ) as WeekdayCode[])
      : []
  let end: RepeatEnd = "never"
  let count = DEFAULT_REPEAT.count
  let until = ""
  if (kv.COUNT) {
    end = "count"
    count = parseInt(kv.COUNT) || count
  } else if (kv.UNTIL) {
    end = "until"
    // Accept YYYYMMDDTHHMMSSZ or YYYYMMDD
    const raw = kv.UNTIL.replace("Z", "")
    if (raw.length >= 8) {
      until = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
    }
  }
  return { mode, interval, byDay, end, count, until }
}

function buildRecurrence(state: RepeatState): RecurrenceRule | null {
  if (state.mode === "none") return null
  const freq =
    state.mode === "daily"
      ? "DAILY"
      : state.mode === "weekly"
        ? "WEEKLY"
        : "MONTHLY"
  const rule: RecurrenceRule = {
    freq,
    interval: Math.max(1, state.interval || 1),
  }
  if (freq === "WEEKLY" && state.byDay.length > 0) {
    rule.by_day = state.byDay
  }
  if (state.end === "count") {
    rule.count = Math.max(1, state.count || 1)
  } else if (state.end === "until" && state.until) {
    const [y, m, d] = state.until.split("-").map(Number)
    rule.until = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).toISOString()
  }
  return rule
}

const VISIBILITY_OPTIONS = [
  {
    value: "public",
    label: "Public",
    help: "Visible in the calendar to everyone.",
  },
  {
    value: "private",
    label: "Private",
    help: "Only listed invitees can see and RSVP.",
  },
  {
    value: "unlisted",
    label: "Unlisted",
    help: "Hidden from the calendar; anyone with the link can view and RSVP.",
  },
] as const

type AvailabilityState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available" }
  | { status: "unavailable"; reason?: string | null }
  | { status: "error"; message: string }

export function EventForm({ defaultValues, onSuccess }: EventFormProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { selectedPopupId } = useWorkspace()
  const isEdit = !!defaultValues

  const { data: venues } = useQuery({
    queryKey: ["event-venues", selectedPopupId],
    queryFn: () =>
      EventVenuesService.listVenues({
        popupId: selectedPopupId!,
        limit: 200,
      }),
    enabled: !!selectedPopupId,
  })

  const [repeat, setRepeat] = useState<RepeatState>(() =>
    parseRruleToState(defaultValues?.rrule ?? null),
  )

  const { data: tracks } = useQuery({
    queryKey: ["tracks", selectedPopupId],
    queryFn: () =>
      TracksService.listTracks({
        popupId: selectedPopupId!,
        limit: 200,
      }),
    enabled: !!selectedPopupId,
  })

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      EventsService.createEvent({ requestBody: data as EventCreate }),
    onSuccess: () => {
      showSuccessToast("Event created successfully")
      queryClient.invalidateQueries({ queryKey: ["events"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const updated = await EventsService.updateEvent({
        eventId: defaultValues!.id,
        requestBody: data,
      })
      // Sync recurrence changes separately (EventUpdate doesn't carry it).
      const currentRule = buildRecurrence(repeat)
      const previousRule = parseRruleToState(defaultValues?.rrule ?? null)
      const ruleChanged =
        JSON.stringify(currentRule) !==
        JSON.stringify(buildRecurrence(previousRule))
      if (ruleChanged) {
        await EventsService.setRecurrence({
          eventId: defaultValues!.id,
          requestBody: { recurrence: currentRule },
        })
      }
      return updated
    },
    onSuccess: () => {
      showSuccessToast("Event updated successfully")
      queryClient.invalidateQueries({ queryKey: ["events"] })
      form.reset()
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const formatForInput = (dt: string | null | undefined) => {
    if (!dt) return ""
    return dt.slice(0, 16)
  }

  // Compute initial duration (in minutes) from the default values (edit mode).
  const initialDurationMinutes = (() => {
    if (!defaultValues?.start_time || !defaultValues?.end_time) return 60
    const diff =
      new Date(defaultValues.end_time).getTime() -
      new Date(defaultValues.start_time).getTime()
    const mins = Math.round(diff / 60000)
    return mins > 0 ? mins : 60
  })()

  type DurationUnit = "minutes" | "hours"
  const initialDurationUnit: DurationUnit =
    initialDurationMinutes % 60 === 0 && initialDurationMinutes >= 60
      ? "hours"
      : "minutes"
  const initialDurationValue =
    initialDurationUnit === "hours"
      ? initialDurationMinutes / 60
      : initialDurationMinutes

  const [durationUnit, setDurationUnit] = useState<DurationUnit>(
    initialDurationUnit,
  )
  const [durationValue, setDurationValue] = useState<number>(
    initialDurationValue,
  )
  const durationMinutes = Math.max(
    1,
    Math.round(
      durationUnit === "hours" ? durationValue * 60 : durationValue,
    ),
  )

  const form = useForm({
    defaultValues: {
      title: defaultValues?.title ?? "",
      content: defaultValues?.content ?? "",
      kind: defaultValues?.kind ?? "",
      start_time: formatForInput(defaultValues?.start_time),
      timezone: defaultValues?.timezone ?? "UTC",
      cover_url: defaultValues?.cover_url ?? "",
      meeting_url: defaultValues?.meeting_url ?? "",
      max_participant: defaultValues?.max_participant?.toString() ?? "",
      venue_id: defaultValues?.venue_id ?? "",
      track_id: defaultValues?.track_id ?? "",
      visibility: (defaultValues?.visibility ?? "public") as
        | "public"
        | "private"
        | "unlisted",
      require_approval: defaultValues?.require_approval ?? false,
      status: defaultValues?.status ?? "draft",
      tags: defaultValues?.tags ?? [],
    },
    onSubmit: ({ value }) => {
      if (!value.title.trim()) {
        showErrorToast("Title is required")
        return
      }
      if (!value.start_time) {
        showErrorToast("Start time is required")
        return
      }
      if (!durationMinutes || durationMinutes <= 0) {
        showErrorToast("Duration must be greater than zero")
        return
      }
      if (!selectedPopupId) {
        showErrorToast("Select a pop-up first")
        return
      }

      const tags = value.tags
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)

      const startDate = new Date(value.start_time)
      const endDate = new Date(startDate.getTime() + durationMinutes * 60_000)

      const payload: Record<string, unknown> = {
        popup_id: selectedPopupId,
        title: value.title,
        content: value.content || null,
        kind: value.kind || null,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        timezone: value.timezone,
        cover_url: value.cover_url || null,
        meeting_url: value.meeting_url || null,
        max_participant: value.max_participant
          ? parseInt(value.max_participant)
          : null,
        venue_id: value.venue_id || null,
        track_id: value.track_id || null,
        visibility: value.visibility,
        require_approval: value.require_approval,
        status: value.status,
        tags,
      }

      if (isEdit) {
        updateMutation.mutate(payload)
      } else {
        const recurrence = buildRecurrence(repeat)
        const createPayload = { ...payload, recurrence }
        createMutation.mutate(createPayload)
      }
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  // Track selected values reactively for side effects / derived queries.
  const venueIdValue = useStore(form.store, (s) => s.values.venue_id)
  const startTimeValue = useStore(form.store, (s) => s.values.start_time)
  const visibilityValue = useStore(form.store, (s) => s.values.visibility)
  const maxParticipantValue = useStore(
    form.store,
    (s) => s.values.max_participant,
  )

  // End time derived from start + duration (used for backend checks).
  const endTimeIso = useMemo(() => {
    if (!startTimeValue) return ""
    const start = new Date(startTimeValue)
    if (Number.isNaN(start.getTime())) return ""
    return new Date(start.getTime() + durationMinutes * 60_000).toISOString()
  }, [startTimeValue, durationMinutes])

  // Fetch selected venue details for capacity / booking mode / setup & teardown
  const { data: selectedVenue } = useQuery({
    queryKey: ["event-venue", venueIdValue],
    queryFn: () =>
      EventVenuesService.getVenue({ venueId: venueIdValue }),
    enabled: !!venueIdValue,
  })

  const isVenueUnbookable = selectedVenue?.booking_mode === "unbookable"

  // --- Availability check (debounced) ------------------------------------
  const [availability, setAvailability] = useState<AvailabilityState>({
    status: "idle",
  })
  const lastCheckKey = useRef<string>("")

  useEffect(() => {
    if (!venueIdValue || !startTimeValue || !endTimeIso) {
      setAvailability({ status: "idle" })
      return
    }
    const key = `${venueIdValue}|${startTimeValue}|${endTimeIso}|${defaultValues?.id ?? ""}`
    if (lastCheckKey.current === key) return

    setAvailability({ status: "checking" })
    const handle = window.setTimeout(async () => {
      lastCheckKey.current = key
      try {
        const result = await EventsService.checkAvailability({
          requestBody: {
            venue_id: venueIdValue,
            start_time: new Date(startTimeValue).toISOString(),
            end_time: endTimeIso,
            exclude_event_id: defaultValues?.id ?? null,
          },
        })
        if (result.available) {
          setAvailability({ status: "available" })
        } else {
          setAvailability({
            status: "unavailable",
            reason: result.reason,
          })
        }
      } catch (err) {
        setAvailability({
          status: "error",
          message: err instanceof Error ? err.message : "Could not check",
        })
      }
    }, 500)

    return () => window.clearTimeout(handle)
  }, [venueIdValue, startTimeValue, endTimeIso, defaultValues?.id])

  // --- Day-based slot picker (date + start/end Selects) -------------------
  // Derived from the form's local-datetime strings.
  const dateStr = startTimeValue ? startTimeValue.slice(0, 10) : ""

  // Popup timezone (used to label slots and compute day bounds consistently
  // with how the backend interprets weekly_hours).
  const { data: popupSettings } = useQuery({
    queryKey: ["event-settings", selectedPopupId],
    queryFn: async () => {
      if (!selectedPopupId) return null
      try {
        return await EventSettingsService.getEventSettings({
          popupId: selectedPopupId,
        })
      } catch {
        return null
      }
    },
    enabled: !!selectedPopupId,
  })
  const popupTz = popupSettings?.timezone ?? "UTC"

  const dayBounds = useMemo(() => {
    if (!dateStr) return null
    return dayBoundsInTz(dateStr, popupTz)
  }, [dateStr, popupTz])

  const { data: dayAvailability } = useQuery({
    queryKey: [
      "event-venue-availability",
      venueIdValue,
      dayBounds?.start.toISOString(),
    ],
    queryFn: () =>
      EventVenuesService.getAvailability({
        venueId: venueIdValue,
        start: dayBounds!.start.toISOString(),
        end: dayBounds!.end.toISOString(),
      }),
    enabled: !!venueIdValue && !!dayBounds,
  })

  const freeIntervals = useMemo(() => {
    if (!dayAvailability || !dayBounds) return []
    return freeIntervalsForDay(
      dayAvailability.open_ranges,
      dayAvailability.busy,
      dayBounds.start,
      dayBounds.end,
    )
  }, [dayAvailability, dayBounds])

  const startSlotOptions = useMemo(
    () =>
      availableStartOptionsForDuration(
        freeIntervals,
        durationMinutes,
        30,
        popupTz,
      ),
    [freeIntervals, durationMinutes, popupTz],
  )

  // Does the typed start + duration fit in a free window?
  const startFits = useMemo(() => {
    if (!startTimeValue) return true
    if (freeIntervals.length === 0) return true // no venue / no day data yet
    const ms = new Date(startTimeValue).getTime()
    if (Number.isNaN(ms)) return true
    return durationFits(freeIntervals, ms, durationMinutes)
  }, [freeIntervals, startTimeValue, durationMinutes])

  // --- Max participant warning -------------------------------------------
  const venueCapacity = selectedVenue?.capacity ?? null
  const maxParticipantNumber = maxParticipantValue
    ? parseInt(maxParticipantValue)
    : null
  const exceedsCapacity =
    venueCapacity != null &&
    maxParticipantNumber != null &&
    !Number.isNaN(maxParticipantNumber) &&
    maxParticipantNumber > venueCapacity

  // --- Invitations (edit mode only, non-public visibility) --------------
  const invitationsEnabled = isEdit && visibilityValue !== "public"
  const { data: invitations } = useQuery({
    queryKey: ["event-invitations", defaultValues?.id],
    queryFn: () =>
      EventsService.listInvitations({ eventId: defaultValues!.id }),
    enabled: invitationsEnabled && !!defaultValues?.id,
  })

  const [inviteEmails, setInviteEmails] = useState("")
  const bulkInviteMutation = useMutation({
    mutationFn: (emails: string[]) =>
      EventsService.bulkInvite({
        eventId: defaultValues!.id,
        requestBody: { emails },
      }),
    onSuccess: (result) => {
      const invited = result.invited?.length ?? 0
      const skipped = result.skipped_existing?.length ?? 0
      const notFound = result.not_found?.length ?? 0
      showSuccessToast(
        `Invited ${invited}, skipped ${skipped}, not found ${notFound}`,
      )
      setInviteEmails("")
      queryClient.invalidateQueries({
        queryKey: ["event-invitations", defaultValues?.id],
      })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deleteInvitationMutation = useMutation({
    mutationFn: (invitationId: string) =>
      EventsService.deleteInvitation({
        eventId: defaultValues!.id,
        invitationId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["event-invitations", defaultValues?.id],
      })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const handleBulkInvite = () => {
    const emails = inviteEmails
      .split(/\r?\n/)
      .map((e) => e.trim())
      .filter(Boolean)
    if (emails.length === 0) {
      showErrorToast("Paste at least one email")
      return
    }
    bulkInviteMutation.mutate(emails)
  }

  // --- Track options -------------------------------------------------------
  const trackOptions = useMemo(() => tracks?.results ?? [], [tracks])

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        form.handleSubmit().catch((err: unknown) => {
          showErrorToast(
            err instanceof Error ? err.message : "Error submitting form",
          )
        })
      }}
      className="max-w-2xl space-y-8"
    >
      {/* ------------------------------------------------------------------
           VENUE FIRST – defines available times & defaults
         ------------------------------------------------------------------ */}
      <InlineSection title="Venue">
        <InlineRow
          label="Venue"
          description="Pick the venue first. It defines available times and capacity."
        >
          <form.Field name="venue_id">
            {(field) => (
              <Select
                value={field.state.value || "__none__"}
                onValueChange={(v) =>
                  field.handleChange(v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="No venue" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No venue</SelectItem>
                  {venues?.results.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.title || "Untitled venue"}
                      {v.capacity ? ` (cap. ${v.capacity})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </form.Field>
        </InlineRow>

        {selectedVenue && (
          <div className="space-y-2 px-1 py-3 text-xs text-muted-foreground">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {selectedVenue.capacity != null && (
                <span>
                  <strong className="text-foreground">Capacity:</strong>{" "}
                  {selectedVenue.capacity}
                </span>
              )}
              {selectedVenue.booking_mode && (
                <span>
                  <strong className="text-foreground">Booking:</strong>{" "}
                  {selectedVenue.booking_mode}
                </span>
              )}
              {selectedVenue.setup_time_minutes != null && (
                <span>
                  <strong className="text-foreground">Setup:</strong>{" "}
                  {selectedVenue.setup_time_minutes} min
                </span>
              )}
              {selectedVenue.teardown_time_minutes != null && (
                <span>
                  <strong className="text-foreground">Teardown:</strong>{" "}
                  {selectedVenue.teardown_time_minutes} min
                </span>
              )}
            </div>
            {isVenueUnbookable && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-destructive">
                This venue is marked as unbookable. Date selection is disabled.
              </p>
            )}
          </div>
        )}
      </InlineSection>

      {/* ------------------------------------------------------------------
           CORE EVENT DETAILS
         ------------------------------------------------------------------ */}
      <form.Field name="title">
        {(field) => (
          <HeroInput
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            onBlur={field.handleBlur}
            placeholder="Event Title"
          />
        )}
      </form.Field>

      <InlineSection title="Event Details">
        <InlineRow label="Type" description="Category of the event">
          <form.Field name="kind">
            {(field) => (
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="workshop, social, talk, panel..."
              />
            )}
          </form.Field>
        </InlineRow>

        <InlineRow label="Date" description="Day the event takes place">
          <Input
            type="date"
            value={dateStr}
            disabled={isVenueUnbookable}
            onChange={(e) => {
              const newDate = e.target.value
              if (!newDate) return
              const currentStartTime = startTimeValue?.slice(11, 16) || "09:00"
              form.setFieldValue(
                "start_time",
                `${newDate}T${currentStartTime}`,
              )
            }}
            className="w-[200px]"
          />
        </InlineRow>

        {venueIdValue ? (
          <InlineRow label="Start time" description="Pick or type a time">
            <div className="flex flex-col items-end gap-1 w-[240px]">
              <StartTimeCombobox
                dateStr={dateStr}
                value={startTimeValue ? startTimeValue.slice(11, 16) : ""}
                onChange={(hhmm) => {
                  if (!hhmm) {
                    form.setFieldValue("start_time", "")
                    return
                  }
                  const date =
                    dateStr || new Date().toISOString().slice(0, 10)
                  form.setFieldValue("start_time", `${date}T${hhmm}`)
                }}
                options={startSlotOptions}
                disabled={isVenueUnbookable}
                fits={startFits}
                placeholder={
                  startSlotOptions.length === 0
                    ? "No open hours"
                    : "HH:mm"
                }
              />
              <AvailabilityIndicator availability={availability} />
            </div>
          </InlineRow>
        ) : (
          <InlineRow label="Start" description="When the event begins">
            <form.Field name="start_time">
              {(field) => (
                <div className="flex flex-col items-end gap-1">
                  <DateTimePicker
                    value={field.state.value}
                    onChange={field.handleChange}
                    placeholder="Select start date"
                  />
                  <AvailabilityIndicator availability={availability} />
                </div>
              )}
            </form.Field>
          </InlineRow>
        )}

        <InlineRow
          label="Duration"
          description="How long the event lasts"
        >
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              value={durationValue}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                setDurationValue(Number.isNaN(n) ? 0 : n)
              }}
              className="w-24"
            />
            <Select
              value={durationUnit}
              onValueChange={(v) => {
                const next = v as DurationUnit
                // Preserve the real duration when switching units.
                if (next !== durationUnit) {
                  const totalMinutes =
                    durationUnit === "hours"
                      ? durationValue * 60
                      : durationValue
                  setDurationUnit(next)
                  setDurationValue(
                    next === "hours"
                      ? Math.max(1, Math.round(totalMinutes / 60))
                      : Math.max(1, Math.round(totalMinutes)),
                  )
                }
              }}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minutes">Minutes</SelectItem>
                <SelectItem value="hours">Hours</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </InlineRow>

        <InlineRow
          label="Repeats"
          description="Make this event recur like Google Calendar."
        >
          <RepeatPicker value={repeat} onChange={setRepeat} />
        </InlineRow>

        <InlineRow
          label="Visibility"
          description="Who can see and RSVP to this event"
        >
          <form.Field name="visibility">
            {(field) => (
              <div className="flex flex-col items-end gap-1">
                <Select
                  value={field.state.value}
                  onValueChange={(v) =>
                    field.handleChange(v as "public" | "private" | "unlisted")
                  }
                >
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VISIBILITY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="max-w-xs text-right text-xs text-muted-foreground">
                  {
                    VISIBILITY_OPTIONS.find((o) => o.value === field.state.value)
                      ?.help
                  }
                </p>
              </div>
            )}
          </form.Field>
        </InlineRow>

        <InlineRow label="Description" description="Details about the event">
          <form.Field name="content">
            {(field) => (
              <Textarea
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                rows={4}
                placeholder="Describe the event..."
              />
            )}
          </form.Field>
        </InlineRow>

        <InlineRow label="Track" description="Optional track this event belongs to">
          <form.Field name="track_id">
            {(field) => (
              <Select
                value={field.state.value || "__none__"}
                onValueChange={(v) =>
                  field.handleChange(v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="(no track)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">(no track)</SelectItem>
                  {trackOptions.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </form.Field>
        </InlineRow>
      </InlineSection>

      {/* ------------------------------------------------------------------
           MEDIA & LINKS
         ------------------------------------------------------------------ */}
      <InlineSection title="Media & Links">
        <div className="space-y-2 py-3">
          <p className="text-sm font-medium">Cover image</p>
          <form.Field name="cover_url">
            {(field) => (
              <div className="space-y-2">
                <ImageUpload
                  value={field.state.value || null}
                  onChange={(url) => field.handleChange(url ?? "")}
                />
                {!field.state.value && (
                  <p className="text-xs text-muted-foreground">
                    Leave empty to use the venue's main photo.
                  </p>
                )}
              </div>
            )}
          </form.Field>
        </div>

        <InlineRow label="Meeting Link" description="Virtual meeting URL">
          <form.Field name="meeting_url">
            {(field) => (
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="https://meet.google.com/..."
              />
            )}
          </form.Field>
        </InlineRow>
      </InlineSection>

      {/* ------------------------------------------------------------------
           OPTIONS
         ------------------------------------------------------------------ */}
      <InlineSection title="Options">
        <InlineRow
          label="Topic"
          description="Press Enter to add a tag. Backspace removes the last."
        >
          <form.Field name="tags">
            {(field) => (
              <ChipInput
                value={field.state.value}
                onChange={(next) => field.handleChange(next)}
              />
            )}
          </form.Field>
        </InlineRow>

        <InlineRow
          label="Max participants"
          description="Override the venue's capacity. Leave empty to use the venue capacity."
        >
          <form.Field name="max_participant">
            {(field) => (
              <div className="flex flex-col items-end gap-1">
                <Input
                  type="number"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder={
                    venueCapacity != null
                      ? `Venue capacity: ${venueCapacity}`
                      : "Unlimited"
                  }
                  className="w-44"
                />
                {exceedsCapacity && venueCapacity != null && (
                  <p className="max-w-xs text-right text-xs text-yellow-600 dark:text-yellow-500">
                    Exceeds venue capacity ({venueCapacity}). Additional
                    attendees will still be allowed.
                  </p>
                )}
              </div>
            )}
          </form.Field>
        </InlineRow>

        <InlineRow
          label="Require Approval"
          description="Participants need admin approval"
        >
          <form.Field name="require_approval">
            {(field) => (
              <Switch
                checked={field.state.value}
                onCheckedChange={field.handleChange}
              />
            )}
          </form.Field>
        </InlineRow>

        <InlineRow label="Status">
          <form.Field name="status">
            {(field) => (
              <div className="flex gap-2">
                {EVENT_STATUSES.map((s) => (
                  <Badge
                    key={s.value}
                    variant={
                      field.state.value === s.value ? "default" : "outline"
                    }
                    className="cursor-pointer"
                    onClick={() => field.handleChange(s.value)}
                  >
                    {s.label}
                  </Badge>
                ))}
              </div>
            )}
          </form.Field>
        </InlineRow>
      </InlineSection>

      {/* ------------------------------------------------------------------
           INVITATIONS (edit mode + non-public only)
         ------------------------------------------------------------------ */}
      {invitationsEnabled && (
        <InlineSection title="Invitations">
          <div className="space-y-3 py-3">
            <Textarea
              value={inviteEmails}
              onChange={(e) => setInviteEmails(e.target.value)}
              rows={4}
              placeholder={"Paste emails, one per line"}
            />
            <div className="flex justify-end">
              <LoadingButton
                type="button"
                size="sm"
                loading={bulkInviteMutation.isPending}
                onClick={handleBulkInvite}
              >
                Invite
              </LoadingButton>
            </div>
          </div>

          <div className="py-3">
            <p className="mb-2 text-sm font-medium">
              Current invitations ({invitations?.length ?? 0})
            </p>
            {invitations && invitations.length > 0 ? (
              <ul className="divide-y divide-border rounded-md border">
                {invitations.map((inv) => {
                  const name = [inv.first_name, inv.last_name]
                    .filter(Boolean)
                    .join(" ")
                  return (
                    <li
                      key={inv.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate">{inv.email}</p>
                        {name && (
                          <p className="truncate text-xs text-muted-foreground">
                            {name}
                          </p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove invitation for ${inv.email}`}
                        disabled={deleteInvitationMutation.isPending}
                        onClick={() =>
                          deleteInvitationMutation.mutate(inv.id)
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                No invitations yet.
              </p>
            )}
          </div>
        </InlineSection>
      )}

      <div className="flex justify-end gap-3">
        <LoadingButton type="submit" loading={isPending}>
          {isEdit ? "Save Changes" : "Create Event"}
        </LoadingButton>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
//  Internal components
// ---------------------------------------------------------------------------

function AvailabilityIndicator({
  availability,
}: {
  availability: AvailabilityState
}) {
  if (availability.status === "idle") return null
  if (availability.status === "checking") {
    return (
      <p className="text-xs text-muted-foreground">Checking availability...</p>
    )
  }
  if (availability.status === "available") {
    return (
      <p className="flex items-center gap-1 text-xs text-green-600 dark:text-green-500">
        <Check className="h-3.5 w-3.5" /> Slot available
      </p>
    )
  }
  if (availability.status === "unavailable") {
    return (
      <p className="flex items-center gap-1 text-xs text-destructive">
        <X className="h-3.5 w-3.5" />{" "}
        {availability.reason ?? "Slot unavailable"}
      </p>
    )
  }
  return (
    <p className="text-xs text-muted-foreground">{availability.message}</p>
  )
}

interface StartTimeComboboxProps {
  /** "YYYY-MM-DD" — required only to contextualize the popover header. */
  dateStr: string
  /** "HH:mm" — the currently selected time (in browser-local for this form). */
  value: string
  onChange: (hhmm: string) => void
  options: { label: string; isoUtc: string }[]
  disabled?: boolean
  fits: boolean
  placeholder?: string
}

function StartTimeCombobox({
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
          <div className="relative">
            <Input
              type="time"
              value={value}
              placeholder={placeholder}
              disabled={disabled}
              onFocus={() => {
                if (options.length > 0) setOpen(true)
              }}
              onChange={(e) => {
                const raw = e.target.value
                // Drop seconds if the browser provided any.
                onChange(raw ? raw.slice(0, 5) : "")
              }}
              className={cn(
                "w-full",
                !fits && value
                  ? "border-destructive focus-visible:ring-destructive/40"
                  : "",
              )}
            />
          </div>
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

interface ChipInputProps {
  value: string[]
  onChange: (next: string[]) => void
}

function ChipInput({ value, onChange }: ChipInputProps) {
  const [draft, setDraft] = useState("")

  const addTag = (raw: string) => {
    const tag = raw.trim().toLowerCase()
    if (!tag) return
    if (value.includes(tag)) {
      setDraft("")
      return
    }
    onChange([...value, tag])
    setDraft("")
  }

  const removeAt = (index: number) => {
    const next = value.slice()
    next.splice(index, 1)
    onChange(next)
  }

  return (
    <div
      className={cn(
        "flex min-h-9 w-80 flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-2 py-1.5",
        "focus-within:ring-[3px] focus-within:ring-ring/50 focus-within:border-ring",
      )}
    >
      {value.map((tag, index) => (
        <span
          key={`${tag}-${index}`}
          className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            className="opacity-70 hover:opacity-100"
            onClick={() => removeAt(index)}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            addTag(draft)
          } else if (e.key === "Backspace" && !draft && value.length > 0) {
            e.preventDefault()
            removeAt(value.length - 1)
          } else if (e.key === "," || e.key === "Tab") {
            if (draft.trim()) {
              e.preventDefault()
              addTag(draft)
            }
          }
        }}
        onBlur={() => {
          if (draft.trim()) addTag(draft)
        }}
        placeholder={value.length === 0 ? "Add tag..." : ""}
        className="flex-1 min-w-[80px] border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
//  Recurrence picker
// ---------------------------------------------------------------------------

interface RepeatPickerProps {
  value: RepeatState
  onChange: (next: RepeatState) => void
}

function RepeatPicker({ value, onChange }: RepeatPickerProps) {
  const update = (patch: Partial<RepeatState>) =>
    onChange({ ...value, ...patch })

  const unitLabel =
    value.mode === "daily"
      ? value.interval === 1
        ? "day"
        : "days"
      : value.mode === "weekly"
        ? value.interval === 1
          ? "week"
          : "weeks"
        : value.mode === "monthly"
          ? value.interval === 1
            ? "month"
            : "months"
          : ""

  return (
    <div className="flex w-full flex-col items-end gap-3">
      <Select
        value={value.mode}
        onValueChange={(v) => update({ mode: v as RepeatMode })}
      >
        <SelectTrigger className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Does not repeat</SelectItem>
          <SelectItem value="daily">Daily</SelectItem>
          <SelectItem value="weekly">Weekly</SelectItem>
          <SelectItem value="monthly">Monthly</SelectItem>
        </SelectContent>
      </Select>

      {value.mode !== "none" && (
        <div className="flex w-full max-w-xs flex-col items-end gap-2 rounded-md border bg-card/40 p-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Every</span>
            <Input
              type="number"
              min={1}
              max={999}
              value={value.interval}
              onChange={(e) =>
                update({ interval: parseInt(e.target.value) || 1 })
              }
              className="w-16"
            />
            <span className="text-xs text-muted-foreground">{unitLabel}</span>
          </div>

          {value.mode === "weekly" && (
            <div className="flex gap-1">
              {WEEKDAY_CODES.map((code) => {
                const active = value.byDay.includes(code)
                return (
                  <button
                    key={code}
                    type="button"
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background text-muted-foreground",
                    )}
                    onClick={() =>
                      update({
                        byDay: active
                          ? value.byDay.filter((c) => c !== code)
                          : [...value.byDay, code],
                      })
                    }
                  >
                    {WEEKDAY_LABELS[code]}
                  </button>
                )
              })}
            </div>
          )}

          <div className="flex flex-col gap-1 text-xs">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="repeat-end"
                checked={value.end === "never"}
                onChange={() => update({ end: "never" })}
              />
              Never
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="repeat-end"
                checked={value.end === "count"}
                onChange={() => update({ end: "count" })}
              />
              After{" "}
              <Input
                type="number"
                min={1}
                max={1000}
                value={value.count}
                onChange={(e) =>
                  update({
                    end: "count",
                    count: parseInt(e.target.value) || 1,
                  })
                }
                className="h-7 w-20"
              />{" "}
              occurrences
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="repeat-end"
                checked={value.end === "until"}
                onChange={() => update({ end: "until" })}
              />
              On{" "}
              <Input
                type="date"
                value={value.until}
                onChange={(e) =>
                  update({ end: "until", until: e.target.value })
                }
                className="h-7 w-36"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
