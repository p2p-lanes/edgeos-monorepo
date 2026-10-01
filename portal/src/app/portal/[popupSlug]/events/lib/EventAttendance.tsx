"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckCircle2,
  ClipboardCheck,
  Search,
  Undo2,
  UserCheck,
} from "lucide-react"
import { type FormEvent, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  type AttendanceCheckInRecord,
  type AttendanceEntry,
  type AttendanceLookupResult,
  type AttendanceMode,
  EventParticipantsService,
  EventsService,
} from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { EventCheckInQr } from "./EventCheckInQr"
import { readApiError } from "./readApiError"

const MODES: AttendanceMode[] = ["none", "host_rollcall", "self_checkin"]

/** Error codes the attendance endpoints answer with, mapped to i18n keys. */
const ERROR_KEYS: Record<string, string> = {
  event_full: "events.attendance.error_event_full",
  ticket_required: "events.attendance.error_ticket_required",
  application_rejected: "events.attendance.error_application_rejected",
  check_in_not_open: "events.attendance.error_not_open",
  check_in_closed: "events.attendance.error_closed",
  attendance_disabled: "events.attendance.error_disabled",
  attendance_mode_locked: "events.attendance.error_mode_locked",
  attendee_not_found: "events.attendance.error_not_found",
  attendee_not_invited: "events.attendance.error_not_invited",
  event_host_cannot_attend: "events.attendance.error_host",
  event_not_published: "events.check_in.error_not_published",
  events_disabled: "events.check_in.error_events_disabled",
  not_checked_in: "events.attendance.error_not_checked_in",
}

function personName(p: {
  first_name?: string | null
  last_name?: string | null
  email?: string | null
}): string {
  const name = [p.first_name, p.last_name].filter(Boolean).join(" ")
  return name || p.email || ""
}

/**
 * The organizer's attendance panel for one occurrence: how attendance is
 * taken, the QR (in self check-in), a walk-in search by exact email and the
 * private roll call with mark / void.
 *
 * Renders only when the roster endpoint answers, and that endpoint 403s for
 * anyone who isn't the event's owner, assigned host or a collaborator, so
 * the gate is a server decision rather than a hidden div. Every rule the
 * buttons imply (mode, window, capacity, eligibility) is enforced there too;
 * the UI only mirrors it to avoid offering what would be refused.
 */
export function EventAttendance({
  eventId,
  occurrenceStart,
  canManage,
  timezone,
}: {
  eventId: string
  occurrenceStart?: string | null
  canManage: boolean
  timezone: string
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const rosterKey = [
    "portal-event-attendance",
    eventId,
    occurrenceStart ?? null,
  ]

  const { data: roster, isSuccess } = useQuery({
    queryKey: rosterKey,
    queryFn: () =>
      EventParticipantsService.getPortalAttendance({
        eventId,
        occurrenceStart: occurrenceStart ?? undefined,
      }),
    enabled: !!eventId && canManage,
    retry: false,
    // Attendees scanning the QR land on the roll call without the organizer
    // doing anything, so poll while scans can actually happen.
    refetchInterval: (query) => {
      const data = query.state.data
      return data?.attendance_mode === "self_checkin" && data.window.is_open
        ? 15_000
        : false
    },
  })

  const describe = (err: unknown) => {
    const { code, message } = readApiError(err)
    return code && ERROR_KEYS[code]
      ? (t(ERROR_KEYS[code]) as string)
      : message || (t("events.attendance.error_generic") as string)
  }

  const refresh = () => {
    setError(null)
    queryClient.invalidateQueries({ queryKey: rosterKey })
    queryClient.invalidateQueries({
      queryKey: ["portal-event-participants", eventId],
    })
  }

  const modeMutation = useMutation({
    mutationFn: (mode: AttendanceMode) =>
      EventsService.updatePortalEventAttendanceMode({
        eventId,
        requestBody: { attendance_mode: mode },
      }),
    onSuccess: () => {
      refresh()
      queryClient.invalidateQueries({ queryKey: ["portal-event", eventId] })
    },
    onError: (err) => setError(describe(err)),
  })

  const markMutation = useMutation({
    mutationFn: (profileId: string) =>
      EventParticipantsService.portalManualCheckIn({
        eventId,
        requestBody: {
          profile_id: profileId,
          occurrence_start: occurrenceStart ?? null,
        },
      }),
    onSuccess: refresh,
    onError: (err) => setError(describe(err)),
  })

  const voidMutation = useMutation({
    mutationFn: ({
      profileId,
      reason,
    }: {
      profileId: string
      reason: string
    }) =>
      EventParticipantsService.portalVoidCheckIn({
        eventId,
        requestBody: {
          profile_id: profileId,
          reason,
          occurrence_start: occurrenceStart ?? null,
        },
      }),
    onSuccess: refresh,
    onError: (err) => setError(describe(err)),
  })

  if (!isSuccess || !roster) return null

  const mode = roster.attendance_mode
  const takesAttendance = mode !== "none"
  const canAct = takesAttendance && roster.window.is_open
  const busy = markMutation.isPending || voidMutation.isPending

  const formatWhen = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      timeZone: timezone,
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso))

  const windowNote = !roster.window.is_open
    ? new Date(roster.window.opens_at) > new Date()
      ? t("events.attendance.window_opens", {
          when: formatWhen(roster.window.opens_at),
        })
      : t("events.attendance.window_closed", {
          when: formatWhen(roster.window.closes_at),
        })
    : null

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">
            {t("events.attendance.heading")}
          </h3>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("events.attendance.help")}
        </p>
      </div>

      <fieldset>
        <legend className="sr-only">{t("events.attendance.mode_label")}</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {MODES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              disabled={modeMutation.isPending}
              onClick={() => mode !== value && modeMutation.mutate(value)}
              className={cn(
                "rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                mode === value
                  ? "border-primary bg-primary/10"
                  : "hover:bg-muted/60",
              )}
            >
              <span className="block font-medium">
                {t(`events.attendance.mode_${value}`)}
              </span>
              <span className="block text-muted-foreground">
                {t(`events.attendance.mode_${value}_help`)}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {mode === "self_checkin" && (
        <EventCheckInQr
          eventId={eventId}
          occurrenceStart={occurrenceStart}
          canManage={canManage}
        />
      )}

      {takesAttendance && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
            <span className="font-medium">
              {t("events.attendance.count", {
                checked: roster.checked_in_count,
                seats: roster.seats_taken,
              })}
            </span>
            {roster.max_participant ? (
              <span className="text-muted-foreground">
                {t("events.attendance.capacity", {
                  max: roster.max_participant,
                })}
              </span>
            ) : null}
          </div>
          {windowNote && (
            <p className="text-xs text-muted-foreground">{windowNote}</p>
          )}

          {canAct && (
            <WalkInSearch
              eventId={eventId}
              occurrenceStart={occurrenceStart}
              busy={busy}
              describe={describe}
              onMark={(profileId) => markMutation.mutate(profileId)}
            />
          )}

          {roster.entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("events.attendance.empty")}
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {roster.entries.map((entry) => (
                <RosterRow
                  key={entry.participant_id}
                  entry={entry}
                  canAct={canAct}
                  busy={busy}
                  formatWhen={formatWhen}
                  onMark={() => markMutation.mutate(entry.profile_id)}
                  onVoid={(reason) =>
                    voidMutation.mutate({ profileId: entry.profile_id, reason })
                  }
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function WalkInSearch({
  eventId,
  occurrenceStart,
  busy,
  describe,
  onMark,
}: {
  eventId: string
  occurrenceStart?: string | null
  busy: boolean
  describe: (err: unknown) => string
  onMark: (profileId: string) => void
}) {
  const { t } = useTranslation()
  const [email, setEmail] = useState("")
  const [found, setFound] = useState<AttendanceLookupResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const lookup = useMutation({
    mutationFn: (value: string) =>
      EventParticipantsService.lookupPortalAttendee({
        eventId,
        email: value,
        occurrenceStart: occurrenceStart ?? undefined,
      }),
    onSuccess: (result) => {
      setFound(result)
      setError(null)
    },
    onError: (err) => {
      setFound(null)
      setError(describe(err))
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (email.trim()) lookup.mutate(email.trim())
  }

  return (
    <div className="space-y-2">
      <form onSubmit={submit} className="flex gap-2">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("events.attendance.search_placeholder") as string}
          aria-label={t("events.attendance.search_label") as string}
          className="h-9 text-sm"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={lookup.isPending || !email.trim()}
        >
          <Search className="mr-1 h-4 w-4" />
          {t("events.attendance.search_button")}
        </Button>
      </form>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {found && (
        <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
          <div className="min-w-0">
            <p className="truncate font-medium">{personName(found)}</p>
            <p className="truncate text-muted-foreground">{found.email}</p>
          </div>
          {found.status === "checked_in" ? (
            <span className="shrink-0 text-emerald-700 dark:text-emerald-400">
              {t("events.attendance.status_checked_in")}
            </span>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => {
                onMark(found.profile_id)
                setFound(null)
                setEmail("")
              }}
            >
              <UserCheck className="mr-1 h-4 w-4" />
              {t("events.attendance.mark_present")}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function RosterRow({
  entry,
  canAct,
  busy,
  formatWhen,
  onMark,
  onVoid,
}: {
  entry: AttendanceEntry
  canAct: boolean
  busy: boolean
  formatWhen: (iso: string) => string
  onMark: () => void
  onVoid: (reason: string) => void
}) {
  const { t } = useTranslation()
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState("")
  const [showHistory, setShowHistory] = useState(false)
  const checkedIn = entry.status === "checked_in"
  const history = entry.history ?? []

  const describeRecord = (r: AttendanceCheckInRecord) => {
    const by = r.checked_in_by.name ?? t("events.attendance.someone")
    const line = t(
      r.method === "qr"
        ? "events.attendance.history_qr"
        : "events.attendance.history_manual",
      { by, when: formatWhen(r.checked_in_at) },
    )
    if (!r.voided_at) return line
    return `${line} · ${t("events.attendance.history_voided", {
      by: r.voided_by?.name ?? t("events.attendance.someone"),
      when: formatWhen(r.voided_at),
      reason: r.void_reason ?? "",
    })}`
  }

  return (
    <li className="space-y-2 px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{personName(entry)}</p>
          <p className="truncate text-muted-foreground">{entry.email}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1",
              checkedIn
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-muted-foreground",
            )}
          >
            {checkedIn && <CheckCircle2 className="h-3.5 w-3.5" />}
            {t(`events.attendance.status_${entry.status}`)}
          </span>
          {canAct && entry.status === "registered" && (
            <Button type="button" size="sm" disabled={busy} onClick={onMark}>
              {t("events.attendance.mark_present")}
            </Button>
          )}
          {canAct && checkedIn && !voiding && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setVoiding(true)}
            >
              <Undo2 className="mr-1 h-3.5 w-3.5" />
              {t("events.attendance.void")}
            </Button>
          )}
        </div>
      </div>

      {voiding && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!reason.trim()) return
            onVoid(reason.trim())
            setVoiding(false)
            setReason("")
          }}
        >
          <Input
            autoFocus
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              t("events.attendance.void_reason_placeholder") as string
            }
            aria-label={t("events.attendance.void_reason_label") as string}
            className="h-8 text-xs"
          />
          <Button
            type="submit"
            size="sm"
            variant="destructive"
            disabled={busy || !reason.trim()}
          >
            {t("events.attendance.void_confirm")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setVoiding(false)
              setReason("")
            }}
          >
            {t("events.attendance.cancel")}
          </Button>
        </form>
      )}

      {history.length > 0 && (
        <div className="text-muted-foreground">
          <p>{describeRecord(history[0])}</p>
          {history.length > 1 && (
            <>
              <button
                type="button"
                className="underline underline-offset-2"
                aria-expanded={showHistory}
                onClick={() => setShowHistory((v) => !v)}
              >
                {showHistory
                  ? t("events.attendance.history_hide")
                  : t("events.attendance.history_show", {
                      count: history.length - 1,
                    })}
              </button>
              {showHistory && (
                <ul className="mt-1 space-y-0.5">
                  {history.slice(1).map((r) => (
                    <li key={r.id}>{describeRecord(r)}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </li>
  )
}
