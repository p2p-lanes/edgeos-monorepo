"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  MapPin,
  User,
} from "lucide-react"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { type EventCheckInResult, EventParticipantsService } from "@/client"
import { Button } from "@/components/ui/button"
import { Loader } from "@/components/ui/Loader"
import { useCityProvider } from "@/providers/cityProvider"
import { CoverImage } from "../../lib/CoverImage"
import { readApiError } from "../../lib/readApiError"
import { useEventTimezone } from "../../lib/useEventTimezone"

/** Error codes the check-in endpoint answers with, mapped to i18n keys. */
const ERROR_KEYS: Record<string, string> = {
  event_full: "events.check_in.error_event_full",
  ticket_required: "events.check_in.error_ticket_required",
  application_rejected: "events.check_in.error_application_rejected",
  check_in_not_open: "events.check_in.error_not_open",
  check_in_closed: "events.check_in.error_closed",
  event_not_published: "events.check_in.error_not_published",
  events_disabled: "events.check_in.error_events_disabled",
  occurrence_not_scheduled: "events.check_in.error_bad_occurrence",
  qr_check_in_disabled: "events.check_in.error_qr_disabled",
}

/**
 * Landing page for the organizer's check-in QR.
 *
 * Authentication (and the return to this exact URL after login) comes from
 * PortalShell, which wraps every /portal route. On arrival the page fires a
 * single POST — the only write in the flow — and then shows its result.
 */
export default function EventCheckInPage() {
  const { t } = useTranslation()
  const params = useParams<{ popupSlug: string; eventId: string }>()
  const searchParams = useSearchParams()
  const occParam = searchParams.get("occ")
  const { getCity } = useCityProvider()
  const city = getCity()
  const { formatDateFull, formatTime } = useEventTimezone(city?.id)
  const queryClient = useQueryClient()

  const mutation = useMutation<EventCheckInResult>({
    mutationFn: () =>
      EventParticipantsService.checkIn({
        eventId: params.eventId,
        requestBody: occParam ? { occurrence_start: occParam } : undefined,
      }),
    // "View event" is the next thing most people tap, and it would otherwise
    // render the cached RSVP status from before the scan.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-event"] })
      queryClient.invalidateQueries({ queryKey: ["portal-event-participants"] })
      queryClient.invalidateQueries({ queryKey: ["portal-events"] })
      queryClient.invalidateQueries({ queryKey: ["portal-events-day"] })
      queryClient.invalidateQueries({ queryKey: ["portal-events-calendar"] })
    },
  })

  // One POST per visit. React StrictMode mounts effects twice in dev and the
  // endpoint is idempotent, but a second call would still be noise in the
  // logs and a second row-lock wait on a busy event.
  const { mutate } = mutation
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current || !params.eventId) return
    fired.current = true
    mutate()
  }, [mutate, params.eventId])

  const eventHref = (() => {
    const base = `/portal/${params.popupSlug}/events/${params.eventId}`
    return occParam ? `${base}?occ=${encodeURIComponent(occParam)}` : base
  })()

  if (mutation.isPending || mutation.isIdle) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-5 py-10">
        <Loader />
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {t("events.check_in.checking_in")}
        </p>
      </div>
    )
  }

  if (mutation.isError) {
    const { code, message } = readApiError(mutation.error)
    const text =
      code && ERROR_KEYS[code]
        ? (t(ERROR_KEYS[code]) as string)
        : message || (t("events.check_in.error_generic") as string)

    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-5 py-10">
        <div className="rounded-3xl border bg-card p-6 text-center shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <CircleAlert className="h-8 w-8 text-muted-foreground" />
          </div>
          <h1 className="mt-5 text-xl font-bold">
            {t("events.check_in.error_heading")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{text}</p>
          <Button asChild variant="outline" className="mt-6 w-full">
            <Link href={eventHref}>{t("events.check_in.view_event")}</Link>
          </Button>
        </div>
      </div>
    )
  }

  const result = mutation.data
  const { event, already_checked_in: alreadyCheckedIn } = result

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-5 py-10">
      <div className="overflow-hidden rounded-3xl border bg-card shadow-sm">
        <CoverImage
          src={event.cover_url}
          alt={event.title}
          className="aspect-[16/9] w-full object-cover"
          sizes="448px"
          fallback={<MapPin className="h-8 w-8 text-muted-foreground/40" />}
        />
        <div className="p-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h1 className="mt-5 text-2xl font-bold">
            {alreadyCheckedIn
              ? t("events.check_in.already_heading")
              : t("events.check_in.success_heading")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {alreadyCheckedIn
              ? t("events.check_in.already_body")
              : t("events.check_in.success_body")}
          </p>

          <div className="mt-6 space-y-2 rounded-2xl bg-muted p-4 text-left">
            <p className="font-semibold">{event.title}</p>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarClock className="h-4 w-4 shrink-0" />
              <span>
                {formatDateFull(event.start_time)} ·{" "}
                {formatTime(event.start_time)} – {formatTime(event.end_time)}
              </span>
            </p>
            {event.host_display_name && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <User className="h-4 w-4 shrink-0" />
                <span>
                  {t("events.detail.hosted_by")}
                  {event.host_display_name}
                </span>
              </p>
            )}
            {event.venue_title && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4 shrink-0" />
                <span>{event.venue_title}</span>
              </p>
            )}
          </div>

          <Button asChild className="mt-6 w-full">
            <Link href={eventHref}>{t("events.check_in.view_event")}</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
