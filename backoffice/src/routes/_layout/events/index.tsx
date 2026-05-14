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
  CalendarIcon,
  CalendarRange,
  CheckCircle2,
  Plus,
  Repeat,
  Video,
  XCircle,
} from "lucide-react"
import { Suspense, useCallback, useMemo, useState } from "react"

import {
  type EventPublic,
  EventSettingsService,
  type EventStatus,
  EventsService,
  type EventVenuePublic,
  EventVenuesService,
  HumansService,
  PopupsService,
} from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import {
  type TableSearchParams,
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import { createErrorHandler } from "@/utils"

const VALID_EVENT_STATUSES: Set<string> = new Set([
  "draft",
  "published",
  "cancelled",
  "pending_approval",
  "rejected",
])

const EVENT_STATUS_OPTIONS: { value: EventStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Public" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "cancelled", label: "Cancelled" },
  { value: "rejected", label: "Rejected" },
]

type EventsSearchParams = TableSearchParams & {
  status?: EventStatus
  venueId?: string
  startDate?: string
  endDate?: string
}

export const Route = createFileRoute("/_layout/events/")({
  component: EventsPage,
  validateSearch: (raw: Record<string, unknown>): EventsSearchParams => ({
    ...validateTableSearch(raw),
    ...(typeof raw.status === "string" && VALID_EVENT_STATUSES.has(raw.status)
      ? { status: raw.status as EventStatus }
      : {}),
    ...(typeof raw.venueId === "string" && raw.venueId
      ? { venueId: raw.venueId }
      : {}),
    ...(typeof raw.startDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(raw.startDate)
      ? { startDate: raw.startDate }
      : {}),
    ...(typeof raw.endDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(raw.endDate)
      ? { endDate: raw.endDate }
      : {}),
  }),
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

const statusVariant: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  draft: "secondary",
  cancelled: "destructive",
  pending_approval: "secondary",
  rejected: "destructive",
}

const statusLabel: Record<string, string> = {
  pending_approval: "Pending approval",
  rejected: "Rejected",
}

const visibilityVariant: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  public: "outline",
  unlisted: "secondary",
  private: "outline",
}

const visibilityLabel: Record<string, string> = {
  public: "Public",
  unlisted: "Unlisted",
  private: "Private",
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

function EventApprovalActions({ event }: { event: EventPublic }) {
  const [decisionOpen, setDecisionOpen] = useState<null | "approve" | "reject">(
    null,
  )
  const [decisionReason, setDecisionReason] = useState("")
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { isOperatorOrAbove } = useAuth()

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

  if (!isOperatorOrAbove || !isPendingApproval) return null

  return (
    <>
      <div className="flex items-center justify-end gap-0.5">
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
                ? `Approve "${event.title}"? It will become public and the creator will be notified.`
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
    </>
  )
}

function EditOccurrenceDialog({
  event,
  onClose,
}: {
  event: EventPublic | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const occurrenceRef = event ? parseOccurrenceId(event.occurrence_id) : null

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
      onClose()
      queryClient.invalidateQueries({ queryKey: ["events"] })
      navigate({
        to: "/events/$eventId/edit",
        params: { eventId: child.id },
      })
    },
    onError: createErrorHandler(showErrorToast),
  })

  return (
    <Dialog open={!!event} onOpenChange={(v) => !v && onClose()}>
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
              onClose()
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
  )
}

function EventHostCell({ event }: { event: EventPublic }) {
  const ownerId = event.owner_id
  const { data: owner } = useQuery({
    queryKey: ["human", ownerId],
    queryFn: () => HumansService.getHuman({ humanId: ownerId }),
    enabled: !!ownerId,
    staleTime: 5 * 60_000,
  })

  const displayName = event.host_display_name?.trim() || null
  const ownerFullName =
    owner && (owner.first_name || owner.last_name)
      ? [owner.first_name, owner.last_name].filter(Boolean).join(" ").trim() ||
        null
      : null
  const primary = displayName || ownerFullName
  const ownerEmail = owner?.email

  return (
    <div className="flex flex-col leading-tight max-w-[220px]">
      <span className="text-sm truncate">{primary ?? "—"}</span>
      {ownerEmail && (
        <span className="text-xs text-muted-foreground truncate">
          {ownerEmail}
        </span>
      )}
    </div>
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
        if (status === "published") {
          const visibility = (row.original.visibility as string) ?? "public"
          return (
            <Badge
              variant={visibilityVariant[visibility] ?? "outline"}
              className={
                visibility === "private"
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-transparent"
                  : undefined
              }
            >
              {visibilityLabel[visibility] ?? visibility}
            </Badge>
          )
        }
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
      id: "host",
      accessorKey: "host_display_name",
      header: "Host",
      cell: ({ row }) => <EventHostCell event={row.original} />,
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
        const customName = row.original.custom_location_name
        if (label) {
          return (
            <span className="text-muted-foreground truncate max-w-[200px] block">
              {label}
            </span>
          )
        }
        if (!venueId && customName) {
          return (
            <span className="text-muted-foreground/80 truncate max-w-[200px] block">
              ⌂ {customName}
            </span>
          )
        }
        if (!venueId) {
          return (
            <span className="text-muted-foreground/80 inline-flex items-center gap-1.5">
              <Video className="h-3.5 w-3.5" />
              Meeting
            </span>
          )
        }
        return <span className="text-muted-foreground">—</span>
      },
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <EventApprovalActions event={row.original} />
        </div>
      ),
    },
  ]
}

function EventStatusFilter({
  selected,
  onSelect,
}: {
  selected: EventStatus | undefined
  onSelect: (value: EventStatus | undefined) => void
}) {
  return (
    <Select
      value={selected ?? "all"}
      onValueChange={(v) =>
        onSelect(v === "all" ? undefined : (v as EventStatus))
      }
    >
      <SelectTrigger className="h-9 w-[150px]">
        <SelectValue placeholder="All statuses" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All statuses</SelectItem>
        {EVENT_STATUS_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function EventVenueFilter({
  venues,
  selected,
  onSelect,
}: {
  venues: EventVenuePublic[]
  selected: string | undefined
  onSelect: (value: string | undefined) => void
}) {
  return (
    <Select
      value={selected ?? "all"}
      onValueChange={(v) => onSelect(v === "all" ? undefined : v)}
    >
      <SelectTrigger className="h-9 w-[170px]">
        <SelectValue placeholder="All venues" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All venues</SelectItem>
        <SelectItem value="meeting">Meeting (online)</SelectItem>
        <SelectItem value="custom">Custom location</SelectItem>
        {venues.map((venue) => (
          <SelectItem key={venue.id} value={venue.id}>
            {venue.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function parseYmd(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const [y, m, d] = value.split("-").map(Number)
  if (!y || !m || !d) return undefined
  return new Date(y, m - 1, d, 12, 0, 0)
}

function formatYmd(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function EventDateRangeFilter({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  popupStart,
  popupEnd,
}: {
  startDate: string | undefined
  endDate: string | undefined
  onStartChange: (value: string | undefined) => void
  onEndChange: (value: string | undefined) => void
  popupStart: string | null | undefined
  popupEnd: string | null | undefined
}) {
  const from = parseYmd(startDate)
  const to = parseYmd(endDate)
  // The popup defines the event window — disallow picking days outside it
  // and anchor the calendar to the popup's first day by default.
  const minDate = parseYmd(popupStart?.slice(0, 10))
  const maxDate = parseYmd(popupEnd?.slice(0, 10))

  const label =
    from && to
      ? `${format(from, "MMM d")} – ${format(to, "MMM d, yyyy")}`
      : from
        ? `From ${format(from, "MMM d, yyyy")}`
        : to
          ? `Until ${format(to, "MMM d, yyyy")}`
          : "Any date"

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-9 w-[220px] justify-start font-normal"
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          <span
            className={`truncate ${from || to ? "" : "text-muted-foreground"}`}
          >
            {label}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          numberOfMonths={2}
          defaultMonth={from ?? minDate ?? new Date()}
          selected={{ from, to }}
          onSelect={(range) => {
            onStartChange(range?.from ? formatYmd(range.from) : undefined)
            onEndChange(range?.to ? formatYmd(range.to) : undefined)
          }}
          disabled={(d) => {
            if (minDate && d < minDate) return true
            if (maxDate && d > maxDate) return true
            return false
          }}
          startMonth={minDate}
          endMonth={maxDate}
          initialFocus
        />
        <div className="flex justify-end border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!from && !to}
            onClick={() => {
              onStartChange(undefined)
              onEndChange(undefined)
            }}
          >
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function EventsTableContent() {
  const searchParams = Route.useSearch()
  const navigate = useNavigate()
  const { selectedPopupId } = useWorkspace()
  const { search, pagination, setSearch, setPagination } = useTableSearchParams(
    searchParams,
    "/events",
  )
  const { status, venueId, startDate, endDate } = searchParams
  // Picking an occurrence row pops a "series or this only" prompt; non-recurring
  // rows skip the dialog and navigate straight to /events/:id/edit.
  const [occurrenceEditTarget, setOccurrenceEditTarget] =
    useState<EventPublic | null>(null)

  const handleRowClick = useCallback(
    (event: EventPublic) => {
      if (parseOccurrenceId(event.occurrence_id)) {
        setOccurrenceEditTarget(event)
        return
      }
      navigate({
        to: "/events/$eventId/edit",
        params: { eventId: event.id },
      })
    },
    [navigate],
  )

  const setStatus = useCallback(
    (value: EventStatus | undefined) => {
      navigate({
        to: "/events",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          status: value,
          page: 0,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  const setVenueId = useCallback(
    (value: string | undefined) => {
      navigate({
        to: "/events",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          venueId: value,
          page: 0,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  const setStartDate = useCallback(
    (value: string | undefined) => {
      navigate({
        to: "/events",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          startDate: value,
          page: 0,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  const setEndDate = useCallback(
    (value: string | undefined) => {
      navigate({
        to: "/events",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          endDate: value,
          page: 0,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  const clearFilters = useCallback(() => {
    navigate({
      to: "/events",
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        status: undefined,
        venueId: undefined,
        startDate: undefined,
        endDate: undefined,
        page: 0,
      }),
      replace: true,
    })
  }, [navigate])

  const hasFilters = !!(status || venueId || startDate || endDate)

  const { data: events } = useQuery({
    queryKey: [
      "events",
      {
        popupId: selectedPopupId,
        page: pagination.pageIndex,
        pageSize: pagination.pageSize,
        search,
        status,
        venueId,
        startDate,
        endDate,
      },
    ],
    queryFn: () =>
      EventsService.listEvents({
        popupId: selectedPopupId!,
        search: search || undefined,
        skip: pagination.pageIndex * pagination.pageSize,
        limit: pagination.pageSize,
        eventStatus: status,
        venueId:
          venueId && venueId !== "custom" && venueId !== "meeting"
            ? venueId
            : undefined,
        locationKind:
          venueId === "custom" || venueId === "meeting" ? venueId : undefined,
        startAfter: startDate ? `${startDate}T00:00:00Z` : undefined,
        startBefore: endDate ? `${endDate}T23:59:59Z` : undefined,
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

  const { data: popup } = useQuery({
    queryKey: ["popup", selectedPopupId],
    queryFn: () => PopupsService.getPopup({ popupId: selectedPopupId! }),
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
      <DataTable
        columns={columns}
        data={events.results}
        searchPlaceholder="Search by title..."
        hiddenOnMobile={["kind", "host", "venue_id", "start_time"]}
        searchValue={search}
        onSearchChange={setSearch}
        onRowClick={handleRowClick}
        serverPagination={{
          total: events.paging.total,
          pagination: pagination,
          onPaginationChange: setPagination,
        }}
        filterBar={
          <div className="flex flex-wrap items-center gap-2">
            <EventStatusFilter selected={status} onSelect={setStatus} />
            <EventVenueFilter
              venues={venues?.results ?? []}
              selected={venueId}
              onSelect={setVenueId}
            />
            <EventDateRangeFilter
              startDate={startDate}
              endDate={endDate}
              onStartChange={setStartDate}
              onEndChange={setEndDate}
              popupStart={popup?.start_date}
              popupEnd={popup?.end_date}
            />
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear
              </Button>
            )}
          </div>
        }
        emptyState={
          hasFilters ? (
            <EmptyState
              icon={CalendarDays}
              title="No events match these filters"
              description="Try adjusting or clearing the filters above."
            />
          ) : !search ? (
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
      <EditOccurrenceDialog
        event={occurrenceEditTarget}
        onClose={() => setOccurrenceEditTarget(null)}
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
