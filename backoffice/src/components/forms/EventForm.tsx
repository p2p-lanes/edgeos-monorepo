import {
  availableStartOptionsForDuration,
  dayBoundsInTz,
  durationFits,
  freeIntervalsForDay,
  localTzNaiveToUtc,
  utcToLocalTzNaive,
} from "@edgeos/shared-events"
import { useForm, useStore } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  type EventCreate,
  type EventPublic,
  EventSettingsService,
  EventsService,
  EventVenuesService,
  TracksService,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { VenueHoursSummary } from "@/components/VenueHoursSummary"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"
import {
  AvailabilityIndicator,
  type AvailabilityState,
} from "./EventForm/AvailabilityIndicator"
import { ChipInput } from "./EventForm/ChipInput"
import {
  buildRecurrence,
  parseRruleToState,
  RepeatPicker,
  type RepeatState,
} from "./EventForm/RepeatPicker"
import { StartTimeCombobox } from "./EventForm/StartTimeCombobox"

interface EventFormProps {
  defaultValues?: EventPublic
  /** Preselected venue for "create event" mode (used by calendar click-to-create). */
  initialVenueId?: string
  /** Preselected start time (UTC ISO) for "create event" mode. */
  initialStartIso?: string
  onSuccess: () => void
}

const EVENT_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
] as const

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

// BYDAY codes index as MO=0, TU=1, ... SU=6 — matches backend day_of_week.
// Declared at module scope so the useMemo dependency stays stable.
const WEEKDAY_CODE_TO_BACKEND: Record<string, number> = {
  MO: 0,
  TU: 1,
  WE: 2,
  TH: 3,
  FR: 4,
  SA: 5,
  SU: 6,
}

export function EventForm({
  defaultValues,
  initialVenueId,
  initialStartIso,
  onSuccess,
}: EventFormProps) {
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

  const formatForInput = (
    dt: string | null | undefined,
    tz: string | null | undefined,
  ) => {
    if (!dt) return ""
    return utcToLocalTzNaive(dt, tz || "UTC")
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

  const [durationUnit, setDurationUnit] =
    useState<DurationUnit>(initialDurationUnit)
  const [durationValue, setDurationValue] =
    useState<number>(initialDurationValue)
  const durationMinutes = Math.max(
    1,
    Math.round(durationUnit === "hours" ? durationValue * 60 : durationValue),
  )

  const form = useForm({
    defaultValues: {
      title: defaultValues?.title ?? "",
      content: defaultValues?.content ?? "",
      kind: defaultValues?.kind ?? "",
      start_time: formatForInput(
        defaultValues?.start_time ?? initialStartIso,
        defaultValues?.timezone,
      ),
      timezone: defaultValues?.timezone ?? "UTC",
      cover_url: defaultValues?.cover_url ?? "",
      meeting_url: defaultValues?.meeting_url ?? "",
      max_participant: defaultValues?.max_participant?.toString() ?? "",
      venue_id: defaultValues?.venue_id ?? initialVenueId ?? "",
      track_id: defaultValues?.track_id ?? "",
      visibility: (defaultValues?.visibility ?? "public") as
        | "public"
        | "private"
        | "unlisted",
      // Attendee-level approval is intentionally not exposed in the UI:
      // the product decision is that events never gate attendee access.
      // The field stays in the schema with a hardcoded ``false`` default so
      // existing records keep round-tripping unchanged.
      require_approval: false,
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

      const tags = value.tags.map((t) => t.trim().toLowerCase()).filter(Boolean)

      // Interpret the naive datetime as wall time in the event's timezone,
      // not the browser's. Otherwise round-tripping through the calendars
      // (which render in popup tz) drifts by the browser↔popup tz delta.
      const startDate = localTzNaiveToUtc(value.start_time, value.timezone)
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
          ? parseInt(value.max_participant, 10)
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
  const timezoneValue = useStore(form.store, (s) => s.values.timezone)
  const visibilityValue = useStore(form.store, (s) => s.values.visibility)
  const maxParticipantValue = useStore(
    form.store,
    (s) => s.values.max_participant,
  )

  // Convert the form's naive datetime (wall time in `timezoneValue`) to a
  // UTC Date for backend calls / derived math.
  const startUtc = useMemo(() => {
    if (!startTimeValue) return null
    const d = localTzNaiveToUtc(startTimeValue, timezoneValue || "UTC")
    return Number.isNaN(d.getTime()) ? null : d
  }, [startTimeValue, timezoneValue])

  // End time derived from start + duration (used for backend checks).
  const endTimeIso = useMemo(() => {
    if (!startUtc) return ""
    return new Date(startUtc.getTime() + durationMinutes * 60_000).toISOString()
  }, [startUtc, durationMinutes])

  // Fetch selected venue details for capacity / booking mode / setup & teardown
  const { data: selectedVenue } = useQuery({
    queryKey: ["event-venue", venueIdValue],
    queryFn: () => EventVenuesService.getVenue({ venueId: venueIdValue }),
    enabled: !!venueIdValue,
  })

  const isVenueUnbookable = selectedVenue?.booking_mode === "unbookable"

  // Map backend weekly_hours (day_of_week: 0=Mon..6=Sun) into a Set of
  // closed weekdays. We consult it both for the DatePicker matcher and the
  // venue summary rendered below the selector.
  const venueWeeklyHours = selectedVenue?.weekly_hours ?? []
  const closedBackendDays = useMemo(() => {
    // Multi-slot aware: a weekday is "closed" when it has no row flagged
    // open with valid open/close times. A single ``is_closed=true`` row is
    // no longer authoritative because a day may contain both open and
    // closed markers when a schedule is edited across sessions.
    const hasOpen = new Set<number>()
    for (const h of venueWeeklyHours) {
      if (!h.is_closed && h.open_time != null && h.close_time != null) {
        hasOpen.add(h.day_of_week)
      }
    }
    const s = new Set<number>()
    for (let d = 0; d < 7; d++) {
      if (!hasOpen.has(d)) s.add(d)
    }
    return s
  }, [venueWeeklyHours])

  // DayPicker gives us JS Date; JS getDay(): 0=Sun..6=Sat. Convert to
  // backend indexing (0=Mon..6=Sun) before the lookup.
  const isClosedOnDate = useMemo(() => {
    if (closedBackendDays.size === 0) return undefined
    return (date: Date) => {
      const backendDay = (date.getDay() + 6) % 7
      return closedBackendDays.has(backendDay)
    }
  }, [closedBackendDays])

  const recurrenceWarning = useMemo<string | null>(() => {
    if (repeat.mode === "none" || closedBackendDays.size === 0) return null
    if (repeat.mode === "weekly") {
      const hits = repeat.byDay
        .filter((code) =>
          closedBackendDays.has(WEEKDAY_CODE_TO_BACKEND[code] ?? -1),
        )
        .map((code) => code)
      if (hits.length > 0) {
        return `Recurrence falls on days the venue is closed (${hits.join(", ")}). Those occurrences will be skipped or rejected.`
      }
      // No byDay → rrule picks from the start weekday. Already covered by
      // DatePicker's disabled matcher on the start date itself.
      return null
    }
    // Daily / monthly: some generated instances almost certainly hit a
    // closed day. Keep it as a gentle heads-up rather than a hard block.
    return "This recurrence may produce instances on days the venue is closed; some occurrences could be rejected."
  }, [repeat, closedBackendDays])

  // --- Availability check (debounced) ------------------------------------
  const [availability, setAvailability] = useState<AvailabilityState>({
    status: "idle",
  })
  const lastCheckKey = useRef<string>("")

  useEffect(() => {
    if (!venueIdValue || !startUtc || !endTimeIso) {
      setAvailability({ status: "idle" })
      return
    }
    const key = `${venueIdValue}|${startUtc.toISOString()}|${endTimeIso}|${defaultValues?.id ?? ""}`
    if (lastCheckKey.current === key) return

    setAvailability({ status: "checking" })
    const handle = window.setTimeout(async () => {
      lastCheckKey.current = key
      try {
        const result = await EventsService.checkAvailability({
          requestBody: {
            venue_id: venueIdValue,
            start_time: startUtc!.toISOString(),
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
  }, [venueIdValue, startUtc, endTimeIso, defaultValues?.id])

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

  // For new events, default the timezone field to the popup's configured tz
  // as soon as settings load — users shouldn't have to hunt for it, and the
  // UTC fallback creates silent round-trip drift against the calendars.
  useEffect(() => {
    if (isEdit || !popupSettings?.timezone) return
    if (form.state.values.timezone && form.state.values.timezone !== "UTC") {
      return
    }
    form.setFieldValue("timezone", popupSettings.timezone)
  }, [isEdit, popupSettings?.timezone, form])

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
    if (!startUtc) return true
    if (freeIntervals.length === 0) return true // no venue / no day data yet
    return durationFits(freeIntervals, startUtc.getTime(), durationMinutes)
  }, [freeIntervals, startUtc, durationMinutes])

  // Combined availability: if the slot doesn't fit locally, report unavailable
  // so we don't show a stale "Slot available" message from the server check.
  const effectiveAvailability: AvailabilityState =
    startTimeValue && !startFits
      ? { status: "unavailable", reason: "Not available — overlaps busy" }
      : availability

  // --- Max participant warning -------------------------------------------
  const venueCapacity = selectedVenue?.capacity ?? null
  const maxParticipantNumber = maxParticipantValue
    ? parseInt(maxParticipantValue, 10)
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
            <VenueHoursSummary hours={venueWeeklyHours} />
            {selectedVenue.description && (
              <p className="whitespace-pre-wrap">
                <strong className="text-foreground">About this venue:</strong>{" "}
                {selectedVenue.description}
              </p>
            )}
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
          <DatePicker
            value={dateStr}
            disabled={isVenueUnbookable}
            disabledDays={isClosedOnDate}
            onChange={(newDate) => {
              if (!newDate) return
              const currentStartTime = startTimeValue?.slice(11, 16) || "09:00"
              form.setFieldValue("start_time", `${newDate}T${currentStartTime}`)
            }}
            className="w-[220px]"
            placeholder="Pick a date"
          />
        </InlineRow>

        <InlineRow label="Duration" description="How long the event lasts">
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
                  const date = dateStr || new Date().toISOString().slice(0, 10)
                  form.setFieldValue("start_time", `${date}T${hhmm}`)
                }}
                options={startSlotOptions}
                disabled={isVenueUnbookable}
                fits={startFits}
                placeholder={
                  startSlotOptions.length === 0 ? "No open hours" : "HH:mm"
                }
              />
              <AvailabilityIndicator availability={effectiveAvailability} />
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
                  <AvailabilityIndicator availability={effectiveAvailability} />
                </div>
              )}
            </form.Field>
          </InlineRow>
        )}

        <InlineRow
          label="Repeats"
          description="Make this event recur like Google Calendar."
        >
          <div className="flex flex-col items-end gap-1">
            <RepeatPicker value={repeat} onChange={setRepeat} />
            {recurrenceWarning && (
              <p className="max-w-xs text-right text-xs text-yellow-600 dark:text-yellow-500">
                {recurrenceWarning}
              </p>
            )}
          </div>
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
                    VISIBILITY_OPTIONS.find(
                      (o) => o.value === field.state.value,
                    )?.help
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

        <InlineRow
          label="Track"
          description="Optional track this event belongs to"
        >
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
                    Exceeds venue capacity ({venueCapacity}).
                  </p>
                )}
              </div>
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
                        onClick={() => deleteInvitationMutation.mutate(inv.id)}
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
