import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { CalendarX, Tag, Users } from "lucide-react"
import { Suspense, useState } from "react"

import {
  EventParticipantsService,
  EventSettingsService,
  EventsService,
  EventVenuesService,
} from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { VenueDayCalendar } from "@/components/VenueDayCalendar"
import { useWorkspace } from "@/contexts/WorkspaceContext"

export const Route = createFileRoute("/_layout/events/day-by-venue")({
  component: DayByVenuePage,
  head: () => ({
    meta: [{ title: "Day by Venue - EdgeOS" }],
  }),
})

function DayByVenueContent({ popupId }: { popupId: string }) {
  const navigate = useNavigate()
  const { data: venues } = useSuspenseQuery({
    queryKey: ["event-venues", { popupId, limit: 200 }],
    queryFn: () => EventVenuesService.listVenues({ popupId, limit: 200 }),
  })
  const { data: settings } = useSuspenseQuery({
    queryKey: ["event-settings", popupId],
    queryFn: () => EventSettingsService.getEventSettings({ popupId }),
  })
  const timezone = settings?.timezone || "UTC"

  const venueList = (venues?.results ?? []).map((v) => ({
    id: v.id,
    title: v.title,
  }))

  const [createAt, setCreateAt] = useState<{
    venueId: string
    startIso: string
  } | null>(null)
  const [activeEventId, setActiveEventId] = useState<string | null>(null)
  const [exceptionReason, setExceptionReason] = useState<string | null>(null)

  const { data: activeEvent } = useQuery({
    queryKey: ["event", activeEventId],
    queryFn: () => EventsService.getEvent({ eventId: activeEventId as string }),
    enabled: !!activeEventId,
  })
  const { data: activeEventParticipants } = useQuery({
    queryKey: ["event-participants", activeEventId],
    queryFn: () =>
      EventParticipantsService.listParticipants({
        eventId: activeEventId as string,
      }),
    enabled: !!activeEventId,
  })
  const activeCount =
    activeEventParticipants?.results?.filter((p) => p.status !== "cancelled")
      .length ?? 0

  return (
    <>
      <VenueDayCalendar
        venues={venueList}
        timezone={timezone}
        onCreateAt={(venueId, startIso) => setCreateAt({ venueId, startIso })}
        onEventClick={setActiveEventId}
        onExceptionClick={(reason) => setExceptionReason(reason ?? "")}
      />

      <Dialog
        open={!!createAt}
        onOpenChange={(open) => !open && setCreateAt(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create event?</DialogTitle>
            <DialogDescription>
              Start a new event at this venue, prefilled with the clicked slot.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateAt(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const payload = createAt
                setCreateAt(null)
                if (!payload) return
                navigate({
                  to: "/events/new",
                  search: {
                    venueId: payload.venueId,
                    startTime: payload.startIso,
                  },
                })
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={exceptionReason !== null}
        onOpenChange={(open) => !open && setExceptionReason(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarX className="h-4 w-4 text-zinc-500" />
              Closed
            </DialogTitle>
            <DialogDescription>
              {exceptionReason
                ? `Reason: ${exceptionReason}`
                : "No reason provided for this closure."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExceptionReason(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!activeEventId}
        onOpenChange={(open) => !open && setActiveEventId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{activeEvent?.title ?? "Event"}</DialogTitle>
            <DialogDescription>
              {activeEvent ? (
                <>
                  {new Date(activeEvent.start_time).toLocaleString(undefined, {
                    timeZone: timezone,
                  })}{" "}
                  –{" "}
                  {new Date(activeEvent.end_time).toLocaleString(undefined, {
                    timeZone: timezone,
                  })}
                </>
              ) : (
                "Loading…"
              )}
            </DialogDescription>
          </DialogHeader>
          {activeEvent && (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>
                  <strong className="text-foreground">Status:</strong>{" "}
                  {activeEvent.status}
                </span>
                {activeEvent.kind && (
                  <span>
                    <strong className="text-foreground">Kind:</strong>{" "}
                    {activeEvent.kind}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {activeCount}
                  {activeEvent.max_participant
                    ? ` / ${activeEvent.max_participant}`
                    : ""}{" "}
                  attending
                </span>
              </div>
              {activeEvent.tags && activeEvent.tags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  {activeEvent.tags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[11px]"
                    >
                      <Tag className="h-2.5 w-2.5" />
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {activeEvent.content && (
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {activeEvent.content}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActiveEventId(null)}>
              Close
            </Button>
            {activeEvent && (
              <Button
                onClick={() =>
                  navigate({
                    to: "/events/$eventId/edit",
                    params: { eventId: activeEvent.id },
                  })
                }
              >
                Edit
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function DayByVenuePage() {
  const { selectedPopupId } = useWorkspace()

  return (
    <FormPageLayout
      title="Day by Venue"
      description="Availability for every venue on a single day"
      backTo="/events"
    >
      {selectedPopupId ? (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-96 w-full" />}>
            <DayByVenueContent popupId={selectedPopupId} />
          </Suspense>
        </QueryErrorBoundary>
      ) : (
        <WorkspaceAlert resource="events" />
      )}
    </FormPageLayout>
  )
}
