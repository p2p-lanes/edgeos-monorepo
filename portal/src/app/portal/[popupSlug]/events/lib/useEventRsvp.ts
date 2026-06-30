"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { ApiError, EventParticipantsService, type EventPublic } from "@/client"

/**
 * Shared RSVP logic used by the list, calendar, and day-view event bodies.
 *
 * @param invalidateQueryKey - The React Query cache key to invalidate after a
 *   successful register or cancel. Each view has its own key:
 *   - list:     `["portal-events"]`
 *   - calendar: `["portal-events-calendar"]`
 *   - day:      `["portal-events-day"]`
 */
export function useEventRsvp(invalidateQueryKey: string[]) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  // Recurring events require occurrence_start so the RSVP targets a single
  // instance. That includes both expanded pseudo-rows (have occurrence_id)
  // AND the series master itself, whose start_time IS the first occurrence.
  // One-off events must not send it.
  const rsvpBodyFor = (e: EventPublic) =>
    e.rrule || e.occurrence_id ? { occurrence_start: e.start_time } : undefined

  const toastRsvpError = (err: unknown) => {
    const fallback = t("events.rsvp.action_error") as string
    let detail = fallback
    if (err instanceof ApiError && err.body && typeof err.body === "object") {
      const body = err.body as { detail?: unknown }
      if (typeof body.detail === "string") detail = body.detail
    }
    toast.error(detail)
  }

  const rsvpMutation = useMutation({
    mutationFn: (e: EventPublic) =>
      EventParticipantsService.registerForEvent({
        eventId: e.id,
        requestBody: rsvpBodyFor(e),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invalidateQueryKey })
    },
    onError: toastRsvpError,
  })

  const cancelRsvpMutation = useMutation({
    mutationFn: (e: EventPublic) =>
      EventParticipantsService.cancelRegistration({
        eventId: e.id,
        requestBody: rsvpBodyFor(e),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invalidateQueryKey })
    },
    onError: toastRsvpError,
  })

  // The in-flight RSVP target in `${id}:${start_time}` format. Including the
  // occurrence start keeps the spinner pinned to the specific recurring
  // instance the user clicked rather than every row sharing the same event id.
  const pendingRsvpKey: string | null = (() => {
    const pending =
      (rsvpMutation.isPending && rsvpMutation.variables) ||
      (cancelRsvpMutation.isPending && cancelRsvpMutation.variables) ||
      null
    return pending ? `${pending.id}:${pending.start_time}` : null
  })()

  return {
    rsvpBodyFor,
    rsvpMutation,
    cancelRsvpMutation,
    pendingRsvpKey,
  }
}
