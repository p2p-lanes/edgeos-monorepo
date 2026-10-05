import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, ClipboardCheck, Search, Undo2 } from "lucide-react"
import { type FormEvent, useState } from "react"
import {
  type ApiError,
  type AttendanceCheckInRecord,
  type AttendanceEntry,
  type AttendanceLookupResult,
  type AttendanceMode,
  EventParticipantsService,
  EventsService,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

const MODE_LABELS: Record<AttendanceMode, string> = {
  none: "Off: no attendance is taken",
  host_rollcall: "Roll call: organizers mark people, no QR",
  self_checkin: "QR + roll call: attendees scan, organizers can still mark",
}

const STATUS_LABELS: Record<string, string> = {
  registered: "RSVP'd",
  checked_in: "Checked in",
  cancelled: "Not attending",
}

function personName(p: {
  first_name?: string | null
  last_name?: string | null
  email?: string | null
}): string {
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || ""
}

function formatWhen(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso))
}

function describeRecord(r: AttendanceCheckInRecord, timezone: string): string {
  const by = r.checked_in_by.name ?? "unknown"
  const how = r.method === "qr" ? "QR scan" : "Marked"
  const line = `${how} by ${by}, ${formatWhen(r.checked_in_at, timezone)}`
  if (!r.voided_at) return line
  return `${line} · voided by ${r.voided_by?.name ?? "unknown"}, ${formatWhen(
    r.voided_at,
    timezone,
  )}: ${r.void_reason ?? ""}`
}

/**
 * Attendance for one occurrence, for operators: the mode, the roll call
 * with mark / void, and a walk-in search by exact email.
 *
 * The backend enforces every rule (mode, window, eligibility, capacity);
 * this card only avoids offering actions it would refuse.
 */
export function EventAttendanceCard({
  eventId,
  occurrenceStart,
  timezone,
}: {
  eventId: string
  occurrenceStart: string | null
  timezone: string
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const onError = createErrorHandler(showErrorToast)
  const rosterKey = ["event-attendance", eventId, occurrenceStart]

  const { data: roster } = useQuery({
    queryKey: rosterKey,
    queryFn: () =>
      EventParticipantsService.getAttendance({
        eventId,
        occurrenceStart: occurrenceStart ?? undefined,
      }),
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: rosterKey })
    queryClient.invalidateQueries({ queryKey: ["event-participants", eventId] })
  }

  const modeMutation = useMutation({
    mutationFn: (mode: AttendanceMode) =>
      EventsService.updateEventAttendanceMode({
        eventId,
        requestBody: { attendance_mode: mode },
      }),
    onSuccess: () => {
      showSuccessToast("Attendance mode updated")
      refresh()
      queryClient.invalidateQueries({ queryKey: ["event", eventId] })
    },
    onError,
  })

  const markMutation = useMutation({
    mutationFn: (profileId: string) =>
      EventParticipantsService.adminManualCheckIn({
        requestBody: {
          profile_id: profileId,
          occurrence_start: occurrenceStart,
        },
        eventId,
      }),
    onSuccess: (result) => {
      showSuccessToast(
        result.already_checked_in
          ? "Already checked in"
          : `${personName(result.entry)} checked in`,
      )
      refresh()
    },
    onError,
  })

  const voidMutation = useMutation({
    mutationFn: ({
      profileId,
      reason,
    }: {
      profileId: string
      reason: string
    }) =>
      EventParticipantsService.adminVoidCheckIn({
        eventId,
        requestBody: {
          profile_id: profileId,
          reason,
          occurrence_start: occurrenceStart,
        },
      }),
    onSuccess: () => {
      showSuccessToast("Check-in voided")
      refresh()
    },
    onError,
  })

  if (!roster) return null

  const mode = roster.attendance_mode
  const takesAttendance = mode !== "none"
  const canAct = takesAttendance && roster.window.is_open
  const busy = markMutation.isPending || voidMutation.isPending

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Attendance</h3>
        </div>
        <Select
          value={mode}
          onValueChange={(value) =>
            modeMutation.mutate(value as AttendanceMode)
          }
          disabled={modeMutation.isPending}
        >
          <SelectTrigger
            className="w-full sm:w-auto"
            aria-label="Attendance mode"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(MODE_LABELS) as AttendanceMode[]).map((value) => (
              <SelectItem key={value} value={value}>
                {MODE_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!takesAttendance ? (
        <p className="text-sm text-muted-foreground">
          Attendance is off for this event.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">
              {roster.checked_in_count} of {roster.seats_taken} checked in
            </span>
            {roster.max_participant ? (
              <span className="text-muted-foreground">
                Capacity {roster.max_participant}
              </span>
            ) : null}
          </div>
          {!roster.window.is_open && (
            <p className="text-sm text-muted-foreground">
              {new Date(roster.window.opens_at) > new Date()
                ? `Check-in opens ${formatWhen(roster.window.opens_at, timezone)}.`
                : `Check-in closed ${formatWhen(roster.window.closes_at, timezone)}.`}
            </p>
          )}

          {canAct && (
            <WalkInSearch
              eventId={eventId}
              occurrenceStart={occurrenceStart}
              busy={busy}
              onMark={(profileId) => markMutation.mutate(profileId)}
            />
          )}

          {roster.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No one has RSVP'd or checked in yet.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {roster.entries.map((entry) => (
                <RosterRow
                  key={entry.participant_id}
                  entry={entry}
                  timezone={timezone}
                  canAct={canAct}
                  busy={busy}
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
  onMark,
}: {
  eventId: string
  occurrenceStart: string | null
  busy: boolean
  onMark: (profileId: string) => void
}) {
  const { showErrorToast } = useCustomToast()
  const onError = createErrorHandler(showErrorToast)
  const [email, setEmail] = useState("")
  const [found, setFound] = useState<AttendanceLookupResult | null>(null)

  const lookup = useMutation({
    mutationFn: (value: string) =>
      EventParticipantsService.lookupAttendee({
        eventId,
        email: value,
        occurrenceStart: occurrenceStart ?? undefined,
      }),
    onSuccess: setFound,
    onError: (err) => {
      setFound(null)
      onError(err as ApiError)
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
          placeholder="Exact email of someone without an RSVP"
          aria-label="Find someone by email"
        />
        <Button
          type="submit"
          variant="outline"
          disabled={lookup.isPending || !email.trim()}
        >
          <Search className="mr-1 h-4 w-4" />
          Find
        </Button>
      </form>
      {found && (
        <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium">{personName(found)}</p>
            <p className="truncate text-muted-foreground">{found.email}</p>
          </div>
          {found.status === "checked_in" ? (
            <Badge variant="outline">Checked in</Badge>
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
              Mark present
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function RosterRow({
  entry,
  timezone,
  canAct,
  busy,
  onMark,
  onVoid,
}: {
  entry: AttendanceEntry
  timezone: string
  canAct: boolean
  busy: boolean
  onMark: () => void
  onVoid: (reason: string) => void
}) {
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState("")
  const checkedIn = entry.status === "checked_in"
  const history = entry.history ?? []

  return (
    <li className="space-y-2 px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{personName(entry)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {entry.email}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={checkedIn ? "default" : "outline"}>
            {checkedIn && <CheckCircle2 className="mr-1 h-3 w-3" />}
            {STATUS_LABELS[entry.status] ?? entry.status}
          </Badge>
          {canAct && entry.status === "registered" && (
            <Button type="button" size="sm" disabled={busy} onClick={onMark}>
              Mark present
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
              Void
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
            placeholder="Reason (required)"
            aria-label="Why is this check-in being voided?"
          />
          <Button
            type="submit"
            size="sm"
            variant="destructive"
            disabled={busy || !reason.trim()}
          >
            Void check-in
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
            Cancel
          </Button>
        </form>
      )}

      {history.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {history.map((r) => (
            <li key={r.id}>{describeRecord(r, timezone)}</li>
          ))}
        </ul>
      )}
    </li>
  )
}
