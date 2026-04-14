import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { format } from "date-fns"
import {
  CalendarDays,
  EllipsisVertical,
  Pencil,
  Plus,
  Repeat,
  Trash2,
} from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import { EventsService, EventVenuesService, type EventPublic } from "@/client"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
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

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—"
  try {
    return format(new Date(dateStr), "MMM d, yyyy HH:mm")
  } catch {
    return "—"
  }
}

const statusVariant: Record<string, "default" | "secondary" | "destructive"> = {
  published: "default",
  draft: "secondary",
  cancelled: "destructive",
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

function EventActionsMenu({ event }: { event: EventPublic }) {
  const [open, setOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editChoiceOpen, setEditChoiceOpen] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const occurrenceRef = parseOccurrenceId(event.occurrence_id)
  const isOccurrence = occurrenceRef !== null

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
      setOpen(false)
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
      setOpen(false)
    },
    onError: createErrorHandler(showErrorToast),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["events"] }),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      EventsService.deleteEvent({ eventId: event.id }),
    onSuccess: () => {
      showSuccessToast("Event deleted successfully")
      setDeleteOpen(false)
      setOpen(false)
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
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Event actions">
            <EllipsisVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              handleEdit()
            }}
          >
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => e.preventDefault()}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editChoiceOpen} onOpenChange={setEditChoiceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit recurring event</DialogTitle>
            <DialogDescription>
              This is one instance of a recurring series. Would you like to
              edit only this event, or the entire series?
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
                setOpen(false)
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
                ? `Skip the "${event.title}" occurrence starting ${formatDateTime(event.start_time)}? Other occurrences in this series will remain.`
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
      cell: ({ row }) => (
        <Badge
          variant={statusVariant[row.original.status as string] ?? "secondary"}
        >
          {row.original.status}
        </Badge>
      ),
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
          {formatDateTime(row.original.start_time)}
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
          <EventActionsMenu event={row.original} />
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

  const { data: events } = useQuery({
    queryKey: [
      "events",
      { popupId: selectedPopupId, page: pagination.pageIndex, pageSize: pagination.pageSize, search },
    ],
    queryFn: () =>
      EventsService.listEvents({
        popupId: selectedPopupId!,
        search: search || undefined,
        skip: pagination.pageIndex * pagination.pageSize,
        limit: pagination.pageSize,
      }),
    enabled: !!selectedPopupId,
    placeholderData: keepPreviousData,
  })

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

  const columns = useMemo(
    () => buildEventColumns(venueNameById),
    [venueNameById],
  )

  if (!events) return <Skeleton className="h-64 w-full" />

  return (
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
            title="No events yet"
            description="Create the first event for this pop-up."
            action={
              <Button asChild>
                <Link to="/events/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Create Event
                </Link>
              </Button>
            }
          />
        ) : undefined
      }
    />
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
          <Button asChild>
            <Link to="/events/new">
              <Plus className="mr-2 h-4 w-4" />
              Create Event
            </Link>
          </Button>
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
