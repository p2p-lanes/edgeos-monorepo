import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import {
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  Eye,
  Pencil,
  Plus,
  Repeat,
  Trash2,
  XCircle,
} from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import {
  type EventPublic,
  EventSettingsService,
  EventsService,
  EventVenuesService,
} from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import { createErrorHandler } from "@/utils"

export const Route = createFileRoute("/_layout/events/")({
  component: EventsPage,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [{ title: "Events - EdgeOS" }],
  }),
})

function formatDateTime(
  dateStr: string | null | undefined,
  timezone?: string,
): string {
  if (!dateStr) return "—"
  try {
    const d = new Date(dateStr)
    if (Number.isNaN(d.getTime())) return "—"
    // All stored times are UTC. Render in the popup's configured timezone so
    // the Events table matches the calendar views (day-by-venue, week) that
    // already use popup tz. Falls back to browser tz if the popup hasn't
    // configured one yet.
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d)
  } catch {
    return "—"
  }
}

const statusVariant: Record<string, "default" | "secondary" | "destructive"> = {
  published: "default",
  draft: "secondary",
  cancelled: "destructive",
  pending_approval: "secondary",
  rejected: "destructive",
}

const statusLabel: Record<string, string> = {
  pending_approval: "Pending approval",
  rejected: "Rejected",
}

function parseOccurrenceId(
  occurrenceId: string | null | undefined,
): { masterId: string; start: string } | null {
  if (!occurrenceId) return null
  const idx = occurrenceId.lastIndexOf("_")
  if (idx < 0) return null
  const masterId = occurrenceId.slice(0, idx)
  const stamp = occurrenceId.slice(idx + 1)
  // stamp format: YYYYMMDDTHHMMSS
  if (stamp.length < 15) return null
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`
  return { masterId, start: iso }
}

function EventActionsMenu({
  event,
  timezone,
}: {
  event: EventPublic
  timezone?: string
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editChoiceOpen, setEditChoiceOpen] = useState(false)
  const [decisionOpen, setDecisionOpen] = useState<null | "approve" | "reject">(
    null,
  )
  const [decisionReason, setDecisionReason] = useState("")
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { isAdmin } = useAuth()

  const occurrenceRef = parseOccurrenceId(event.occurrence_id)
  const isOccurrence = occurrenceRef !== null
  const isPendingApproval = event.status === "pending_approval"

  const approveMutation = useMutation({
    mutationFn: () =>
      EventsService.approveEvent({
        eventId: event.id,
        requestBody: { reason: decisionReason.trim() || null },
      }),
    onSuccess: () => {
      showSuccessToast("Event approved")
      setDecisionOpen(null)
      setDecisionReason("")
    },
    onError: createErrorHandler(showErrorToast),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["events"] }),
  })

  const rejectMutation = useMutation({
    mutationFn: () =>
      EventsService.rejectEvent({
        eventId: event.id,
        requestBody: { reason: decisionReason.trim() || null },
      }),
    onSuccess: () => {
      showSuccessToast("Event rejected")
      setDecisionOpen(null)
      setDecisionReason("")
    },
    onError: createErrorHandler(showErrorToast),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["events"] }),
  })

  const detachMutation = useMutation({
    mutationFn: async () => {
      if (!occurrenceRef) throw new Error("Not an occurrence")
      return EventsService.detachOccurrence({
        eventId: occurrenceRef.masterId,
        requestBody: { occurrence_start: occurrenceRef.start },
      })
    },
    onSuccess: (child) => {
      showSuccessToast("Detached occurrence for editing")
      setEditChoiceOpen(false)
      queryClient.invalidateQueries({ queryKey: ["events"] })
      navigate({
        to: "/events/$eventId/edit",
        params: { eventId: child.id },
      })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deleteOccurrenceMutation = useMutation({
    mutationFn: async () => {
      if (!occurrenceRef) throw new Error("Not an occurrence")
      return EventsService.deleteOccurrence({
        eventId: occurrenceRef.masterId,
        requestBody: { occurrence_start: occurrenceRef.start },
      })
    },
    onSuccess: () => {
      showSuccessToast("Occurrence removed")
      setDeleteOpen(false)
    },
    onError: createErrorHandler(showErrorToast),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["events"] }),
  })

  const deleteMutation = useMutation({
    mutationFn: () => EventsService.deleteEvent({ eventId: event.id }),
    onSuccess: () => {
      showSuccessToast("Event deleted successfully")
      setDeleteOpen(false)
    },
    onError: createErrorHandler(showErrorToast),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["events"] }),
  })

  const handleEdit = () => {
    if (isOccurrence) {
      setEditChoiceOpen(true)
    } else {
      navigate({
        to: "/events/$eventId/edit",
        params: { eventId: event.id },
      })
    }
  }

  return (
    <>
      <div className="flex items-center justify-end gap-0.5">
        {isAdmin && isPendingApproval && (
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Approve event"
              title="Approve"
              onClick={() => {
                setDecisionOpen("approve")
                setDecisionReason("")
              }}
            >
              <CheckCircle2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Reject event"
              title="Reject"
              onClick={() => {
                setDecisionOpen("reject")
                setDecisionReason("")
              }}
            >
              <XCircle className="h-4 w-4" />
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={isAdmin ? "Edit event" : "View event"}
          title={isAdmin ? "Edit" : "View"}
          onClick={handleEdit}
        >
          {isAdmin ? (
            <Pencil className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </Button>
        {isAdmin && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete event"
            title="Delete"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <Dialog
        open={!!decisionOpen}
        onOpenChange={(v) => !v && setDecisionOpen(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decisionOpen === "approve" ? "Approve event" : "Reject event"}
            </DialogTitle>
            <DialogDescription>
              {decisionOpen === "approve"
                ? `Approve "${event.title}"? It will become published and the creator will be notified.`
                : `Reject "${event.title}"? The creator will be notified. You can leave an optional reason.`}
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={decisionReason}
            onChange={(e) => setDecisionReason(e.target.value)}
            rows={3}
            placeholder={
              decisionOpen === "approve"
                ? "Optional note to the organizer"
                : "Optional reason (shown to the organizer)"
            }
            className="w-full rounded-md border bg-background p-2 text-sm"
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <LoadingButton
              variant={decisionOpen === "reject" ? "destructive" : "default"}
              loading={
                decisionOpen === "approve"
                  ? approveMutation.isPending
                  : rejectMutation.isPending
              }
              onClick={() =>
                decisionOpen === "approve"
                  ? approveMutation.mutate()
                  : rejectMutation.mutate()
              }
            >
              {decisionOpen === "approve" ? "Approve" : "Reject"}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editChoiceOpen} onOpenChange={setEditChoiceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit recurring event</DialogTitle>
            <DialogDescription>
              This is one instance of a recurring series. Would you like to edit
              only this event, or the entire series?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="outline"
              onClick={() => {
                if (!occurrenceRef) return
                setEditChoiceOpen(false)
                navigate({
                  to: "/events/$eventId/edit",
                  params: { eventId: occurrenceRef.masterId },
                })
              }}
            >
              Edit series
            </Button>
            <LoadingButton
              loading={detachMutation.isPending}
              onClick={() => detachMutation.mutate()}
            >
              Edit only this event
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isOccurrence ? "Delete this occurrence" : "Delete Event"}
            </DialogTitle>
            <DialogDescription>
              {isOccurrence
                ? `Skip the "${event.title}" occurrence starting ${formatDateTime(event.start_time, timezone)}? Other occurrences in this series will remain.`
                : `Are you sure you want to delete "${event.title}"? This action cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <LoadingButton
              variant="destructive"
              loading={
                isOccurrence
                  ? deleteOccurrenceMutation.isPending
                  : deleteMutation.isPending
              }
              onClick={() =>
                isOccurrence
                  ? deleteOccurrenceMutation.mutate()
                  : deleteMutation.mutate()
              }
            >
              {isOccurrence ? "Skip" : "Delete"}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function buildEventColumns(
  venueNameById: Map<string, string>,
  timezone: string | undefined,
): ColumnDef<EventPublic>[] {
  return [
    {
      accessorKey: "title",
      header: ({ column }) => <SortableHeader label="Title" column={column} />,
      cell: ({ row }) => (
        <span className="font-medium inline-flex items-center gap-1.5">
          {row.original.title}
          {row.original.rrule && (
            <Repeat
              className="h-3.5 w-3.5 text-muted-foreground"
              aria-label="Recurring event"
            />
          )}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = row.original.status as string
        return (
          <Badge
            variant={statusVariant[status] ?? "secondary"}
            className={
              status === "pending_approval"
                ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 border-transparent"
                : undefined
            }
          >
            {statusLabel[status] ?? status}
          </Badge>
        )
      },
    },
    {
      accessorKey: "kind",
      header: "Type",
      cell: ({ row }) => (
        <span className="text-muted-foreground capitalize">
          {row.original.kind || "—"}
        </span>
      ),
    },
    {
      accessorKey: "start_time",
      header: ({ column }) => <SortableHeader label="Start" column={column} />,
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {formatDateTime(row.original.start_time, timezone)}
        </span>
      ),
    },
    {
      accessorKey: "venue_id",
      header: "Venue",
      cell: ({ row }) => {
        const venueId = row.original.venue_id
        const label = venueId ? venueNameById.get(venueId) : null
        return (
          <span className="text-muted-foreground truncate max-w-[200px] block">
            {label ?? "—"}
          </span>
        )
      },
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <EventActionsMenu event={row.original} timezone={timezone} />
        </div>
      ),
    },
  ]
}

function EventsTableContent() {
  const searchParams = Route.useSearch()
  const { selectedPopupId } = useWorkspace()
  const { search, pagination, setSearch, setPagination } = useTableSearchParams(
    searchParams,
    "/events",
  )
  const [pendingOnly, setPendingOnly] = useState(false)

  const { data: events } = useQuery({
    queryKey: [
      "events",
      {
        popupId: selectedPopupId,
        page: pagination.pageIndex,
        pageSize: pagination.pageSize,
        search,
        pendingOnly,
      },
    ],
    queryFn: () =>
      EventsService.listEvents({
        popupId: selectedPopupId!,
        search: search || undefined,
        skip: pagination.pageIndex * pagination.pageSize,
        limit: pagination.pageSize,
        // Backend accepts a single status filter; fetch everything and
        // narrow client-side for simplicity when the toggle is off.
        eventStatus: pendingOnly ? "pending_approval" : undefined,
      }),
    enabled: !!selectedPopupId,
    placeholderData: keepPreviousData,
  })

  const pendingCount = useMemo(
    () =>
      events?.results.filter((e) => e.status === "pending_approval").length ??
      0,
    [events],
  )

  const { data: venues } = useQuery({
    queryKey: ["event-venues", { popupId: selectedPopupId, limit: 200 }],
    queryFn: () =>
      EventVenuesService.listVenues({
        popupId: selectedPopupId!,
        limit: 200,
      }),
    enabled: !!selectedPopupId,
  })

  const venueNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const v of venues?.results ?? []) map.set(v.id, v.title)
    return map
  }, [venues])

  // Popup timezone drives display of every start_time in the table so the
  // "Events" list matches the calendar views. Falls back to browser tz if
  // settings haven't loaded or aren't configured for this popup.
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
  const popupTz = popupSettings?.timezone ?? undefined

  const columns = useMemo(
    () => buildEventColumns(venueNameById, popupTz),
    [venueNameById, popupTz],
  )

  if (!events) return <Skeleton className="h-64 w-full" />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={pendingOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setPendingOnly((v) => !v)}
          aria-pressed={pendingOnly}
        >
          <CheckCircle2 className="mr-2 h-4 w-4" />
          Pending approval
          {!pendingOnly && pendingCount > 0 && (
            <Badge variant="secondary" className="ml-2">
              {pendingCount}
            </Badge>
          )}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={events.results}
        searchPlaceholder="Search by title..."
        hiddenOnMobile={["kind", "venue_id", "start_time"]}
        searchValue={search}
        onSearchChange={setSearch}
        serverPagination={{
          total: events.paging.total,
          pagination: pagination,
          onPaginationChange: setPagination,
        }}
        emptyState={
          !search ? (
            <EmptyState
              icon={CalendarDays}
              title={pendingOnly ? "No pending requests" : "No events yet"}
              description={
                pendingOnly
                  ? "Events awaiting venue approval will appear here."
                  : "Create the first event for this pop-up."
              }
              action={
                pendingOnly ? undefined : (
                  <Button asChild>
                    <Link to="/events/new">
                      <Plus className="mr-2 h-4 w-4" />
                      Create Event
                    </Link>
                  </Button>
                )
              }
            />
          ) : undefined
        }
      />
    </div>
  )
}

function EventsPage() {
  const { selectedPopupId } = useWorkspace()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Events</h1>
          <p className="text-muted-foreground">
            Manage events for the selected pop-up
          </p>
        </div>
        {selectedPopupId && (
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/events/day-by-venue">
                <CalendarRange className="mr-2 h-4 w-4" />
                Day by venue
              </Link>
            </Button>
            <Button asChild>
              <Link to="/events/new">
                <Plus className="mr-2 h-4 w-4" />
                Create Event
              </Link>
            </Button>
          </div>
        )}
      </div>
      {selectedPopupId ? (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <EventsTableContent />
          </Suspense>
        </QueryErrorBoundary>
      ) : (
        <WorkspaceAlert resource="events" />
      )}
    </div>
  )
}
