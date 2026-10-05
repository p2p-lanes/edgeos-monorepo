import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ChevronDown } from "lucide-react"
import { useState } from "react"

import {
  ApiError,
  type EventParticipantPublic,
  EventParticipantsService,
  type EventPublic,
  type EventSeriesOccurrence,
  EventsService,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"

type FormatRange = (
  start: string,
  end: string,
  timezone?: string | null,
) => string

function ParticipantNames({
  participants,
}: {
  participants: EventParticipantPublic[]
}) {
  if (!participants.length) {
    return <p className="text-sm text-muted-foreground">No active RSVPs</p>
  }
  return (
    <ul className="divide-y">
      {participants.map((participant) => (
        <li
          key={participant.id}
          className="flex items-center justify-between gap-3 py-2 text-sm"
        >
          <span>
            {[participant.first_name, participant.last_name]
              .filter(Boolean)
              .join(" ") || "Unnamed participant"}
          </span>
          <Badge variant="outline">
            {participant.status === "checked_in" ? "Checked in" : "RSVP'd"}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

function OccurrenceGroup({
  occurrence,
  formatRange,
}: {
  occurrence: EventSeriesOccurrence
  formatRange: FormatRange
}) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: [
      "event-participants",
      occurrence.event_id,
      occurrence.occurrence_start,
      "series-roster",
    ],
    queryFn: async () => {
      const request = {
        eventId: occurrence.event_id,
        occurrenceStart: occurrence.occurrence_start ?? undefined,
      }
      let page = await EventParticipantsService.listParticipants(request)
      const results = [...page.results]
      while (
        page.paging &&
        page.paging.total > page.paging.offset + page.results.length
      ) {
        page = await EventParticipantsService.listParticipants({
          ...request,
          skip: page.paging.offset + page.paging.limit,
        })
        results.push(...page.results)
      }
      return results
        .filter((p) => p.status !== "cancelled")
        .sort((a, b) =>
          `${a.first_name ?? ""} ${a.last_name ?? ""}`.localeCompare(
            `${b.first_name ?? ""} ${b.last_name ?? ""}`,
          ),
        )
    },
    enabled: occurrence.attendee_count > 0,
    retry: false,
  })
  return (
    <section
      aria-label={`Occurrence: ${formatRange(occurrence.start_time, occurrence.end_time, occurrence.timezone)}`}
      className="rounded-lg border"
    >
      <div className="flex flex-wrap items-center gap-2 p-3">
        <h4 className="min-w-0 flex-1 text-sm font-medium">
          {formatRange(
            occurrence.start_time,
            occurrence.end_time,
            occurrence.timezone,
          )}
        </h4>
        <span className="text-xs text-muted-foreground">
          {occurrence.attendee_count}{" "}
          {occurrence.attendee_count === 1 ? "RSVP" : "RSVPs"}
        </span>
        {occurrence.is_detached && (
          <Badge variant="outline">Separate occurrence</Badge>
        )}
        {occurrence.status === "cancelled" && (
          <Badge variant="outline">Cancelled</Badge>
        )}
        <Link
          to="/events/$eventId"
          params={{ eventId: occurrence.event_id }}
          search={{ occ: occurrence.occurrence_start ?? undefined }}
          aria-label={`View occurrence: ${formatRange(occurrence.start_time, occurrence.end_time, occurrence.timezone)}`}
          className="text-xs font-medium text-primary hover:underline"
        >
          View occurrence
        </Link>
      </div>
      <div className="border-t px-3 py-2">
        {occurrence.attendee_count === 0 ? (
          <ParticipantNames participants={[]} />
        ) : isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : isError ? (
          <div role="alert" className="text-sm">
            Couldn't load participants.{" "}
            <Button variant="ghost" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <ParticipantNames participants={data ?? []} />
        )}
      </div>
    </section>
  )
}

export function OtherSeriesOccurrences({
  event,
  formatRange,
}: {
  event: EventPublic
  formatRange: FormatRange
}) {
  const [open, setOpen] = useState(false)
  const seriesId = event.recurrence_master_id ?? event.id
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["event-series-summary", seriesId],
    queryFn: () => EventsService.getEventSeriesSummary({ eventId: seriesId }),
    enabled: open,
    retry: false,
  })
  const currentStart = event.resolved_occurrence_start
  const occurrences =
    data?.occurrences.filter(
      (row) =>
        !(
          row.event_id === event.id &&
          (row.occurrence_start === null
            ? !currentStart
            : !!currentStart &&
              Date.parse(row.occurrence_start) === Date.parse(currentStart))
        ),
    ) ?? []
  const summaryError =
    error instanceof ApiError &&
    error.status === 400 &&
    typeof error.body === "object" &&
    error.body !== null &&
    "detail" in error.body &&
    typeof error.body.detail === "string"
      ? error.body.detail
      : "Couldn't load the series."
  const dateFormat = new Intl.DateTimeFormat("en-US", {
    timeZone: data?.timezone || event.timezone || "UTC",
    dateStyle: "medium",
  })

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-xl border bg-card"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 p-4 text-left"
        >
          <span>
            <span className="block text-sm font-semibold">
              Other occurrences in this series
            </span>
            <span className="block mt-1 text-xs text-muted-foreground">
              Other dates and their own participant lists, including dates with
              no RSVPs.
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t p-4">
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : isError ? (
          <div role="alert" className="text-sm">
            {summaryError}{" "}
            <Button variant="ghost" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          data && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {dateFormat.format(new Date(data.window_start))} –{" "}
                  {dateFormat.format(new Date(Date.parse(data.window_end) - 1))}{" "}
                  · {data.timezone}
                </span>
              </div>
              {occurrences.length ? (
                occurrences.map((occurrence) => (
                  <OccurrenceGroup
                    key={`${occurrence.event_id}:${occurrence.occurrence_start ?? "oneoff"}`}
                    occurrence={occurrence}
                    formatRange={formatRange}
                  />
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No other occurrences in this date range.
                </p>
              )}
              {!!data.outside_schedule.length && (
                <section className="space-y-2 rounded-lg border border-amber-500/40 p-3">
                  <h4 className="text-sm font-semibold">
                    RSVPs outside the current schedule
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    These registrations do not match a scheduled occurrence.
                    They are shown separately and cannot be opened as a
                    scheduled date.
                  </p>
                  {data.outside_schedule.map((group) => (
                    <section
                      key={`${group.event_id}:${group.occurrence_start ?? "legacy"}`}
                      className="rounded-lg border"
                    >
                      <div className="flex items-center justify-between gap-2 p-3 text-sm">
                        <h5>
                          {group.title} ·{" "}
                          {group.occurrence_start
                            ? new Intl.DateTimeFormat("en-US", {
                                timeZone: group.timezone,
                                dateStyle: "medium",
                                timeStyle: "short",
                              }).format(new Date(group.occurrence_start))
                            : "No occurrence date (legacy RSVP)"}
                        </h5>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {group.attendee_count}{" "}
                          {group.attendee_count === 1 ? "RSVP" : "RSVPs"}
                        </span>
                      </div>
                      <div className="border-t px-3 py-2">
                        <ParticipantNames participants={group.participants} />
                      </div>
                    </section>
                  ))}
                </section>
              )}
            </>
          )
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
