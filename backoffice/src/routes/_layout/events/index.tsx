import { dayBoundsInTz } from "@edgeos/shared-events"
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
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Plus,
  Repeat,
  Search,
  Video,
  X,
  XCircle,
} from "lucide-react"
import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"

import {
  type EventHostOption,
  type EventPublic,
  EventSettingsService,
  type EventStatus,
  EventsService,
  type EventVenuePublic,
  EventVenuesService,
  type EventVisibility,
  HumansService,
  PopupsService,
} from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { EventsCalendarView } from "@/components/events/EventsCalendarView"
import { EventsDayView } from "@/components/events/EventsDayView"
import { EventsListView } from "@/components/events/EventsListView"
import {
  type EventsView,
  EventsViewSwitcher,
} from "@/components/events/EventsViewSwitcher"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
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
import {
  type EventStatusFilter,
  resolveStatusFilter,
  VALID_EVENT_STATUS_FILTERS,
} from "@/lib/events/statusFilter"
import { createErrorHandler } from "@/utils"

const EVENT_STATUS_OPTIONS: { value: EventStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Public" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "cancelled", label: "Cancelled" },
  { value: "rejected", label: "Rejected" },
]

const VALID_EVENT_VISIBILITIES: Set<string> = new Set([
  "public",
  "unlisted",
  "private",
])

const EVENT_VISIBILITY_OPTIONS: { value: EventVisibility; label: string }[] = [
  { value: "public", label: "Public" },
  { value: "unlisted", label: "Unlisted" },
  { value: "private", label: "Private" },
]

const VALID_EVENT_VIEWS: Set<string> = new Set([
  "table",
  "list",
  "calendar",
  "day",
])

// Remember the last view the user picked so returning to /events (or a fresh
// session) lands on it. Defaults to the card "list" view when nothing is
// stored yet.
const EVENTS_VIEW_STORAGE_KEY = "edgeos:events-view"

function readStoredEventsView(): EventsView | null {
  if (typeof window === "undefined") return null
  const v = window.localStorage.getItem(EVENTS_VIEW_STORAGE_KEY)
  return v && VALID_EVENT_VIEWS.has(v) ? (v as EventsView) : null
}

type EventsSearchParams = TableSearchParams & {
  status?: EventStatusFilter
  visibility?: EventVisibility
  venueId?: string
  creatorId?: string
  startDate?: string
  endDate?: string
  view?: EventsView
  date?: string
}

export const Route = createFileRoute("/_layout/events/")({
  component: EventsPage,
  validateSearch: (raw: Record<string, unknown>): EventsSearchParams => ({
    ...validateTableSearch(raw),
    ...(typeof raw.status === "string" &&
    VALID_EVENT_STATUS_FILTERS.has(raw.status)
      ? { status: raw.status as EventStatusFilter }
      : {}),
    ...(typeof raw.visibility === "string" &&
    VALID_EVENT_VISIBILITIES.has(raw.visibility)
      ? { visibility: raw.visibility as EventVisibility }
      : {}),
    ...(typeof raw.venueId === "string" && raw.venueId
      ? { venueId: raw.venueId }
      : {}),
    ...(typeof raw.creatorId === "string" && raw.creatorId
      ? { creatorId: raw.creatorId }
      : {}),
    ...(typeof raw.startDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(raw.startDate)
      ? { startDate: raw.startDate }
      : {}),
    ...(typeof raw.endDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(raw.endDate)
      ? { endDate: raw.endDate }
      : {}),
    ...(typeof raw.view === "string" && VALID_EVENT_VIEWS.has(raw.view)
      ? { view: raw.view as EventsView }
      : {}),
    ...(typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)
      ? { date: raw.date }
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
                  ? "bg-warning-soft text-warning border-transparent"
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
                ? "bg-warning-soft text-warning border-transparent"
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

function EventStatusSelect({
  selected,
  onSelect,
}: {
  selected: EventStatusFilter | undefined
  onSelect: (value: EventStatusFilter | undefined) => void
}) {
  return (
    <Select
      value={selected ?? "active"}
      onValueChange={(v) => onSelect(v as EventStatusFilter)}
    >
      <SelectTrigger className="h-9 w-[150px]">
        <SelectValue placeholder="Active Events" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="active">Active Events</SelectItem>
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

function EventVisibilityFilter({
  selected,
  onSelect,
}: {
  selected: EventVisibility | undefined
  onSelect: (value: EventVisibility | undefined) => void
}) {
  return (
    <Select
      value={selected ?? "all"}
      onValueChange={(v) =>
        onSelect(v === "all" ? undefined : (v as EventVisibility))
      }
    >
      <SelectTrigger className="h-9 w-[150px]">
        <SelectValue placeholder="All visibilities" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All visibilities</SelectItem>
        {EVENT_VISIBILITY_OPTIONS.map((opt) => (
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

function EventCreatorFilter({
  hosts,
  selected,
  onSelect,
}: {
  hosts: EventHostOption[]
  selected: string | undefined
  onSelect: (value: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const selectedHost = hosts.find((h) => h.id === selected)
  const label = selected
    ? selectedHost?.name?.trim() || selectedHost?.email || "Selected creator"
    : "All creators"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-[200px] justify-between font-normal"
        >
          <span
            className={`truncate ${selected ? "" : "text-muted-foreground"}`}
          >
            {label}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search by name or email..." />
          <CommandList>
            <CommandEmpty>No creators found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="all creators"
                onSelect={() => {
                  onSelect(undefined)
                  setOpen(false)
                }}
              >
                <Check
                  className={`mr-2 h-4 w-4 ${selected ? "opacity-0" : "opacity-100"}`}
                />
                All creators
              </CommandItem>
              {hosts.map((host) => {
                const name = host.name?.trim() || null
                return (
                  <CommandItem
                    key={host.id}
                    // cmdk matches the typed query against this string, so
                    // include both name and email to make the picker searchable.
                    value={`${name ?? ""} ${host.email}`}
                    onSelect={() => {
                      onSelect(host.id)
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={`mr-2 h-4 w-4 shrink-0 ${selected === host.id ? "opacity-100" : "opacity-0"}`}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{name ?? host.email}</span>
                      {name && (
                        <span className="truncate text-xs text-muted-foreground">
                          {host.email}
                        </span>
                      )}
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
  // Comparing Dates directly here is unsafe: react-day-picker hands us
  // cells at local midnight, while parseYmd anchors at noon to dodge DST
  // edge cases — so a cell on the boundary day would read as "<minDate"
  // and get disabled. Pin the comparison to YMD strings instead.
  const minYmd = popupStart?.slice(0, 10) ?? undefined
  const maxYmd = popupEnd?.slice(0, 10) ?? undefined
  const cellYmd = (d: Date) => {
    const y = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, "0")
    const dd = String(d.getDate()).padStart(2, "0")
    return `${y}-${mm}-${dd}`
  }

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
            const ymd = cellYmd(d)
            if (minYmd && ymd < minYmd) return true
            if (maxYmd && ymd > maxYmd) return true
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

function EventsTableContent({
  onRowClick,
}: {
  onRowClick: (event: EventPublic) => void
}) {
  const searchParams = Route.useSearch()
  const navigate = useNavigate()
  const { selectedPopupId } = useWorkspace()
  const { search, pagination, setSearch, setPagination } = useTableSearchParams(
    searchParams,
    "/events",
  )
  const { status, visibility, venueId, creatorId, startDate, endDate } =
    searchParams

  const setStatus = useCallback(
    (value: EventStatusFilter | undefined) => {
      navigate({
        to: "/events",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          // "active" is the default preset, so keep it out of the URL.
          status: value === "active" ? undefined : value,
          page: 0,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  const setVisibility = useCallback(
    (value: EventVisibility | undefined) => {
      navigate({
        to: "/events",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          visibility: value,
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

  const setCreatorId = useCallback(
    (value: string | undefined) => {
      navigate({
        to: "/events",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          creatorId: value,
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
        visibility: undefined,
        venueId: undefined,
        creatorId: undefined,
        startDate: undefined,
        endDate: undefined,
        page: 0,
      }),
      replace: true,
    })
  }, [navigate])

  const hasFilters = !!(
    status ||
    visibility ||
    venueId ||
    creatorId ||
    startDate ||
    endDate
  )

  // Popup timezone drives display of every start_time in the table so the
  // "Events" list matches the calendar views. We render a skeleton until
  // settings resolve to avoid a browser-tz flash on first paint, and we use
  // popup-tz day boundaries for the date filter so events near midnight in
  // popup TZ aren't clipped.
  const { data: popupSettings, isLoading: popupSettingsLoading } = useQuery({
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
  // Fall back to UTC (the backend default for EventSettings.timezone) when
  // settings haven't been created yet. Never fall back to browser tz — that
  // would make the list display drift from the calendar/day views and emails.
  const popupTz = popupSettings?.timezone ?? "UTC"

  const filterStartAfter = useMemo(() => {
    if (!startDate) return undefined
    if (popupTz) return dayBoundsInTz(startDate, popupTz).start.toISOString()
    return `${startDate}T00:00:00Z`
  }, [startDate, popupTz])

  const filterStartBefore = useMemo(() => {
    if (!endDate) return undefined
    if (popupTz) return dayBoundsInTz(endDate, popupTz).end.toISOString()
    return `${endDate}T23:59:59Z`
  }, [endDate, popupTz])

  const { data: events } = useQuery({
    queryKey: [
      "events",
      {
        popupId: selectedPopupId,
        page: pagination.pageIndex,
        pageSize: pagination.pageSize,
        search,
        status,
        visibility,
        venueId,
        creatorId,
        startDate,
        endDate,
        popupTz,
      },
    ],
    queryFn: () => {
      const { eventStatus, excludeStatuses } = resolveStatusFilter(status)
      return EventsService.listEvents({
        popupId: selectedPopupId!,
        search: search || undefined,
        skip: pagination.pageIndex * pagination.pageSize,
        limit: pagination.pageSize,
        eventStatus,
        excludeStatuses,
        visibility,
        venueId:
          venueId && venueId !== "custom" && venueId !== "meeting"
            ? venueId
            : undefined,
        locationKind:
          venueId === "custom" || venueId === "meeting" ? venueId : undefined,
        ownerId: creatorId || undefined,
        startAfter: filterStartAfter,
        startBefore: filterStartBefore,
      })
    },
    enabled: !!selectedPopupId && !popupSettingsLoading,
    placeholderData: keepPreviousData,
  })

  const { data: hosts } = useQuery({
    queryKey: ["event-hosts", selectedPopupId],
    queryFn: () => EventsService.listEventHosts({ popupId: selectedPopupId! }),
    enabled: !!selectedPopupId,
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

  const columns = useMemo(
    () => buildEventColumns(venueNameById, popupTz),
    [venueNameById, popupTz],
  )

  if (!events || popupSettingsLoading)
    return <Skeleton className="h-64 w-full" />

  return (
    <div className="space-y-3">
      <DataTable
        columns={columns}
        data={events.results}
        searchPlaceholder="Search by title..."
        hiddenOnMobile={["kind", "host", "venue_id", "start_time"]}
        searchValue={search}
        onSearchChange={setSearch}
        onRowClick={onRowClick}
        serverPagination={{
          total: events.paging.total,
          pagination: pagination,
          onPaginationChange: setPagination,
        }}
        filterBar={
          <div className="flex flex-wrap items-center gap-2">
            <EventStatusSelect selected={status} onSelect={setStatus} />
            <EventVisibilityFilter
              selected={visibility}
              onSelect={setVisibility}
            />
            <EventVenueFilter
              venues={venues?.results ?? []}
              selected={venueId}
              onSelect={setVenueId}
            />
            <EventCreatorFilter
              hosts={hosts ?? []}
              selected={creatorId}
              onSelect={setCreatorId}
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
              description="Create the first event for this gathering."
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
    </div>
  )
}

function CalendarDayToolbar({
  popupId,
  status,
  venueId,
  search,
  setStatus,
  setVenueId,
  setSearch,
}: {
  popupId: string
  status: EventStatusFilter | undefined
  venueId: string | undefined
  search: string
  setStatus: (value: EventStatusFilter | undefined) => void
  setVenueId: (value: string | undefined) => void
  setSearch: (value: string) => void
}) {
  const { data: venues } = useQuery({
    queryKey: ["event-venues", { popupId, limit: 200 }],
    queryFn: () => EventVenuesService.listVenues({ popupId, limit: 200 }),
    enabled: !!popupId,
  })

  const [localSearch, setLocalSearch] = useState(search)
  useEffect(() => {
    setLocalSearch(search)
  }, [search])

  // Debounce search so we don't push a URL update on every keystroke.
  useEffect(() => {
    if (localSearch === search) return
    const id = setTimeout(() => setSearch(localSearch), 300)
    return () => clearTimeout(id)
  }, [localSearch, search, setSearch])

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="relative w-full min-w-0 sm:max-w-xs">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by title..."
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          className="pl-9 pr-8"
        />
        {localSearch && (
          <button
            type="button"
            onClick={() => {
              setLocalSearch("")
              setSearch("")
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <EventStatusSelect selected={status} onSelect={setStatus} />
        <EventVenueFilter
          venues={venues?.results ?? []}
          selected={venueId}
          onSelect={setVenueId}
        />
      </div>
    </div>
  )
}

function parseSelectedDate(value: string | undefined): Date | null {
  if (!value) return null
  const [y, m, d] = value.split("-").map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, 12, 0, 0)
}

function EventsPage() {
  const { selectedPopupId } = useWorkspace()
  const navigate = useNavigate()
  const searchParams = Route.useSearch()
  const view: EventsView = searchParams.view ?? readStoredEventsView() ?? "list"
  const selectedDate = parseSelectedDate(searchParams.date)

  const { data: popup } = useQuery({
    queryKey: ["popup", selectedPopupId],
    queryFn: () => PopupsService.getPopup({ popupId: selectedPopupId! }),
    enabled: !!selectedPopupId,
  })
  const popupStart = popup?.start_date ?? null
  const popupEnd = popup?.end_date ?? null

  // Day-view fullscreen overlay. Local state only — refreshes drop the
  // overlay. Switching away from day view auto-collapses it so we never
  // leave a hidden overlay floating over table/calendar.
  const [isDayFullscreen, setIsDayFullscreen] = useState(false)
  useEffect(() => {
    if (view !== "day" && isDayFullscreen) setIsDayFullscreen(false)
  }, [view, isDayFullscreen])
  // Lock body scroll while fullscreen so the overlay's inner scroll owns
  // vertical movement; restore prior value on cleanup.
  useEffect(() => {
    if (!isDayFullscreen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [isDayFullscreen])
  // Esc closes the overlay.
  useEffect(() => {
    if (!isDayFullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsDayFullscreen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isDayFullscreen])
  const toggleDayFullscreen = useCallback(
    () => setIsDayFullscreen((v) => !v),
    [],
  )
  // Track mount so createPortal's `document.body` target is available
  // (SSR-safe even though TanStack Router is client-rendered).
  const [isMounted, setIsMounted] = useState(false)
  useEffect(() => {
    setIsMounted(true)
  }, [])

  const handleRowClick = useCallback(
    (event: EventPublic) => {
      // Open the read-only view page (which owns the edit/share actions and,
      // for a recurring instance, the "series vs this occurrence" choice).
      // Occurrences route to their master id with the instance start in `occ`.
      const occ = parseOccurrenceId(event.occurrence_id)
      navigate({
        to: "/events/$eventId",
        params: { eventId: occ ? occ.masterId : event.id },
        search: occ ? { occ: occ.start } : {},
      })
    },
    [navigate],
  )

  const setView = useCallback(
    (next: EventsView) => {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(EVENTS_VIEW_STORAGE_KEY, next)
      }
      navigate({
        to: "/events",
        search: (prev: Record<string, unknown>) => {
          const prevDate = typeof prev.date === "string" ? prev.date : undefined
          return {
            ...prev,
            view: next,
            date: next === "day" ? prevDate : undefined,
          }
        },
        replace: true,
      })
    },
    [navigate],
  )

  const setDate = useCallback(
    (next: Date) => {
      const y = next.getFullYear()
      const m = String(next.getMonth() + 1).padStart(2, "0")
      const d = String(next.getDate()).padStart(2, "0")
      navigate({
        to: "/events",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          date: `${y}-${m}-${d}`,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  const setStatusGlobal = useCallback(
    (value: EventStatusFilter | undefined) => {
      navigate({
        to: "/events",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          // "active" is the default preset, so keep it out of the URL.
          status: value === "active" ? undefined : value,
          page: 0,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  const setVenueIdGlobal = useCallback(
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

  const setSearchGlobal = useCallback(
    (value: string) => {
      navigate({
        to: "/events",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          search: value || undefined,
          page: 0,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Events</h1>
          <p className="text-muted-foreground">
            Manage events for the selected gathering
          </p>
        </div>
        {selectedPopupId && (
          <div className="flex items-center gap-2">
            <EventsViewSwitcher view={view} onViewChange={setView} />
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
            {view === "table" && (
              <EventsTableContent onRowClick={handleRowClick} />
            )}
            {view === "list" && (
              <div className="space-y-3">
                {/* Keep the search + filters pinned under the app top bar
                    (h-16) so they stay reachable while scrolling a long list.
                    Frosted white background covers the cards passing beneath. */}
                <div className="sticky top-16 z-10 -mx-6 border-b bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-8 md:px-8">
                  <CalendarDayToolbar
                    popupId={selectedPopupId}
                    status={searchParams.status}
                    venueId={searchParams.venueId}
                    search={searchParams.search ?? ""}
                    setStatus={setStatusGlobal}
                    setVenueId={setVenueIdGlobal}
                    setSearch={setSearchGlobal}
                  />
                </div>
                <EventsListView
                  popupId={selectedPopupId}
                  status={searchParams.status}
                  venueId={searchParams.venueId}
                  search={searchParams.search ?? ""}
                  popupStart={popupStart}
                  popupEnd={popupEnd}
                  onEventClick={handleRowClick}
                />
              </div>
            )}
            {view === "calendar" && (
              <div className="space-y-3">
                <CalendarDayToolbar
                  popupId={selectedPopupId}
                  status={searchParams.status}
                  venueId={searchParams.venueId}
                  search={searchParams.search ?? ""}
                  setStatus={setStatusGlobal}
                  setVenueId={setVenueIdGlobal}
                  setSearch={setSearchGlobal}
                />
                <EventsCalendarView
                  popupId={selectedPopupId}
                  status={searchParams.status}
                  venueId={searchParams.venueId}
                  search={searchParams.search ?? ""}
                  popupStart={popupStart}
                  popupEnd={popupEnd}
                  onEventClick={handleRowClick}
                />
              </div>
            )}
            {view === "day" && !isDayFullscreen && (
              <div className="space-y-3">
                <CalendarDayToolbar
                  popupId={selectedPopupId}
                  status={searchParams.status}
                  venueId={searchParams.venueId}
                  search={searchParams.search ?? ""}
                  setStatus={setStatusGlobal}
                  setVenueId={setVenueIdGlobal}
                  setSearch={setSearchGlobal}
                />
                <EventsDayView
                  popupId={selectedPopupId}
                  status={searchParams.status}
                  venueId={searchParams.venueId}
                  search={searchParams.search ?? ""}
                  selectedDate={selectedDate}
                  onSelectedDateChange={setDate}
                  popupStart={popupStart}
                  popupEnd={popupEnd}
                  onEventClick={handleRowClick}
                  isFullscreen={false}
                  onToggleFullscreen={toggleDayFullscreen}
                />
              </div>
            )}
          </Suspense>
        </QueryErrorBoundary>
      ) : (
        <WorkspaceAlert resource="events" />
      )}
      {isMounted &&
        isDayFullscreen &&
        view === "day" &&
        selectedPopupId &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col gap-3 bg-background p-3 sm:p-4 overflow-y-auto"
            role="dialog"
            aria-modal="true"
          >
            <CalendarDayToolbar
              popupId={selectedPopupId}
              status={searchParams.status}
              venueId={searchParams.venueId}
              search={searchParams.search ?? ""}
              setStatus={setStatusGlobal}
              setVenueId={setVenueIdGlobal}
              setSearch={setSearchGlobal}
            />
            <EventsDayView
              popupId={selectedPopupId}
              status={searchParams.status}
              venueId={searchParams.venueId}
              search={searchParams.search ?? ""}
              selectedDate={selectedDate}
              onSelectedDateChange={setDate}
              popupStart={popupStart}
              popupEnd={popupEnd}
              onEventClick={handleRowClick}
              isFullscreen={true}
              onToggleFullscreen={toggleDayFullscreen}
            />
          </div>,
          document.body,
        )}
    </div>
  )
}
