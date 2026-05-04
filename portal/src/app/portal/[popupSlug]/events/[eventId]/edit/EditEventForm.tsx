"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import {
  ApiError,
  type EventPublic,
  EventsService,
  type EventUpdate,
  type TrackPublic,
  TracksService,
} from "@/client"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { EventScheduleFields } from "../../components/EventScheduleFields"
import {
  formatDateKeyInTz,
  formatHhmmInTz,
  useEventScheduling,
} from "../../lib/useEventScheduling"
import {
  useEventTimezone,
  usePortalEventSettings,
} from "../../lib/useEventTimezone"
import { usePopupWindow } from "../../lib/usePopupWindow"
import { useVenueAvailability } from "../../lib/useVenueAvailability"
import { CapacityField } from "./sections/CapacityField"
import { CoverImageField } from "./sections/CoverImageField"
import { FormFooter } from "./sections/FormFooter"
import { FormHeader } from "./sections/FormHeader"
import { TopicTagsField } from "./sections/TopicTagsField"
import { TrackField } from "./sections/TrackField"
import { VenueSection } from "./sections/VenueSection"
import { VisibilityField } from "./sections/VisibilityField"
import { useEditEventForm } from "./useEditEventForm"

interface EditEventFormProps {
  event: EventPublic
  popupId: string
  citySlug: string
  cityName: string
  cityStartDate?: string | null
  cityEndDate?: string | null
}

export function EditEventForm({
  event,
  popupId,
  citySlug,
  cityName,
  cityStartDate,
  cityEndDate,
}: EditEventFormProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { timezone } = useEventTimezone(popupId)
  const displayTz = timezone || "UTC"

  const { data: settings } = usePortalEventSettings(popupId)

  const { isDateOutsidePopupWindow, popupStartKey, popupWindowLabel } =
    usePopupWindow({
      startDate: cityStartDate,
      endDate: cityEndDate,
    })

  const { data: tracksData } = useQuery({
    queryKey: ["portal-tracks", popupId],
    queryFn: () =>
      TracksService.listPortalTracks({ popupId: popupId, limit: 200 }),
    enabled: !!popupId,
  })
  const tracks: TrackPublic[] = tracksData?.results ?? []

  const form = useEditEventForm(event)

  // Derive initial scheduling values from `event`. Memoised so the lazy
  // initialisers inside `useEventScheduling` only run once per mount.
  // `key={event.id}` on the parent forces a remount when navigating between
  // events, so depending on event.id is unnecessary here.
  const initialSchedule = useMemo(() => {
    const eventTz = event.timezone || displayTz
    const startDate = new Date(event.start_time)
    const endDate = new Date(event.end_time)
    const minutes = Math.max(
      1,
      Math.round((endDate.getTime() - startDate.getTime()) / 60_000),
    )
    return {
      initialDateStr: formatDateKeyInTz(startDate, eventTz),
      initialTimeStr: formatHhmmInTz(startDate, eventTz),
      initialDurationMinutes: minutes,
    }
  }, [event.timezone, event.start_time, event.end_time, displayTz])

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
  } = useEventScheduling({
    displayTz,
    initialDateStr: initialSchedule.initialDateStr,
    initialTimeStr: initialSchedule.initialTimeStr,
    initialDurationMinutes: initialSchedule.initialDurationMinutes,
  })

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
    venueId: form.venueId,
    dateStr,
    displayTz,
    startIso,
    endIso,
    durationMinutes,
    excludeEventId: event.id,
    isDateOutsidePopupWindow,
    popupStartKey,
    setDateStr,
    setTimeStr,
  })

  const updateMutation = useMutation({
    mutationFn: (payload: EventUpdate) =>
      EventsService.updatePortalEvent({
        eventId: event.id,
        requestBody: payload,
      }),
    onSuccess: () => {
      toast.success(t("events.form.event_updated_success"))
      queryClient.invalidateQueries({ queryKey: ["portal-event"] })
      queryClient.invalidateQueries({ queryKey: ["portal-events"] })
      router.push(`/portal/${citySlug}/events/${event.id}`)
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError
          ? ((err.body as { detail?: string })?.detail ?? err.message)
          : (err as Error).message
      toast.error(msg)
    },
  })

  const venueMaxCapacity = selectedVenue?.capacity ?? null
  const venueDisabled = selectedVenue?.booking_mode === "unbookable"

  const canSubmit =
    !!form.title.trim() &&
    !!startIso &&
    !!endIso &&
    (!form.venueId || withinOpenHours) &&
    availability !== "conflict" &&
    availability !== "checking" &&
    !updateMutation.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    updateMutation.mutate(
      form.buildPayload(timezone || "UTC", startIso, endIso),
    )
  }

  const eventDetailHref = `/portal/${citySlug}/events/${event.id}`

  return (
    <div className="flex flex-col max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
      <FormHeader
        backHref={eventDetailHref}
        cityName={cityName}
        timezone={timezone || ""}
      />

      <form onSubmit={handleSubmit} className="space-y-5">
        <VenueSection
          venueId={form.venueId}
          onVenueChange={form.setVenueId}
          venues={venues}
          selectedVenue={selectedVenue}
          selectedDateIsClosed={selectedDateIsClosed}
          selectedVenueLabel={event.venue_title ?? undefined}
        />

        <div className="space-y-2">
          <Label htmlFor="title">{t("events.form.title_label")}</Label>
          <Input
            id="title"
            value={form.title}
            onChange={(e) => form.setTitle(e.target.value)}
            required
          />
        </div>

        <CoverImageField coverUrl={form.coverUrl} onChange={form.setCoverUrl} />

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
          venueId={form.venueId}
          withinOpenHours={withinOpenHours}
          availability={availability}
          availabilityLoaded={!!availabilityData}
          startOptionsCount={startOptions.length}
          nearbyStartOptions={nearbyStartOptions}
          onSuggestionPick={setTimeStr}
          disabled={venueDisabled}
        />

        <VisibilityField
          value={form.visibility}
          onChange={form.setVisibility}
        />

        <div className="space-y-2">
          <Label htmlFor="desc">{t("events.form.description_label")}</Label>
          <Textarea
            id="desc"
            rows={4}
            value={form.content}
            onChange={(e) => form.setContent(e.target.value)}
          />
        </div>

        <CapacityField
          value={form.maxParticipants}
          onChange={form.setMaxParticipants}
          venueMaxCapacity={venueMaxCapacity}
        />

        <TopicTagsField
          allowedTags={settings?.allowed_tags}
          value={form.tags}
          onChange={form.setTags}
        />

        <div className="space-y-2">
          <Label htmlFor="meeting">{t("events.form.meeting_url_label")}</Label>
          <Input
            id="meeting"
            type="url"
            value={form.meetingUrl}
            onChange={(e) => form.setMeetingUrl(e.target.value)}
            placeholder={t("events.form.meeting_url_placeholder")}
          />
        </div>

        <TrackField
          tracks={tracks}
          value={form.trackId}
          onChange={form.setTrackId}
        />

        <FormFooter
          onCancel={() => router.push(eventDetailHref)}
          canSubmit={canSubmit}
          isSubmitting={updateMutation.isPending}
        />
      </form>
    </div>
  )
}
