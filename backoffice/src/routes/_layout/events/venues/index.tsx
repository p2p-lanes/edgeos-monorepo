import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import {
  CalendarRange,
  Check,
  CheckCircle2,
  GripVertical,
  LayoutGrid,
  MapPin,
  Plus,
  Search,
  Table as TableIcon,
  X,
} from "lucide-react"
import { Suspense, useEffect, useMemo, useState } from "react"

import {
  type ApiError,
  type EventVenuePublic,
  EventVenuesService,
  type VenueBookingMode,
} from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { VenuesGridView } from "@/components/events/VenuesGridView"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import { cn } from "@/lib/utils"
import { createErrorHandler } from "@/utils"

const BOOKING_MODE_LABELS: Record<VenueBookingMode, string> = {
  free: "Permissionless",
  approval_required: "Approval required",
  unbookable: "Unbookable",
}

type VenuesView = "table" | "grid"

const VALID_VENUES_VIEWS: Set<string> = new Set(["table", "grid"])

// Remember the last venues view; defaults to the card "grid" when unset.
const VENUES_VIEW_STORAGE_KEY = "edgeos:venues-view"

function readStoredVenuesView(): VenuesView | null {
  if (typeof window === "undefined") return null
  const v = window.localStorage.getItem(VENUES_VIEW_STORAGE_KEY)
  return v && VALID_VENUES_VIEWS.has(v) ? (v as VenuesView) : null
}

type VenuesSearchParams = ReturnType<typeof validateTableSearch> & {
  view?: VenuesView
}

export const Route = createFileRoute("/_layout/events/venues/")({
  component: VenuesPage,
  validateSearch: (raw: Record<string, unknown>): VenuesSearchParams => ({
    ...validateTableSearch(raw),
    ...(typeof raw.view === "string" && VALID_VENUES_VIEWS.has(raw.view)
      ? { view: raw.view as VenuesView }
      : {}),
  }),
  head: () => ({
    meta: [{ title: "Venues - EdgeOS" }],
  }),
})

function VenuesViewSwitcher({
  view,
  onViewChange,
}: {
  view: VenuesView
  onViewChange: (view: VenuesView) => void
}) {
  return (
    <div className="inline-flex rounded-md border bg-card p-0.5">
      <Button
        type="button"
        variant={view === "table" ? "default" : "ghost"}
        size="sm"
        aria-label="Table"
        title="Table"
        aria-pressed={view === "table"}
        onClick={() => onViewChange("table")}
        className={cn(
          "h-7 w-7 rounded-sm p-0",
          view === "table" && "shadow-none",
        )}
      >
        <TableIcon className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant={view === "grid" ? "default" : "ghost"}
        size="sm"
        aria-label="Grid"
        title="Grid"
        aria-pressed={view === "grid"}
        onClick={() => onViewChange("grid")}
        className={cn(
          "h-7 w-7 rounded-sm p-0",
          view === "grid" && "shadow-none",
        )}
      >
        <LayoutGrid className="h-4 w-4" />
      </Button>
    </div>
  )
}

function VenuesGridContent() {
  const searchParams = Route.useSearch()
  const { selectedPopupId } = useWorkspace()
  const { search, setSearch } = useTableSearchParams(
    searchParams,
    "/events/venues/",
  )
  const [localSearch, setLocalSearch] = useState(search)
  useEffect(() => setLocalSearch(search), [search])
  useEffect(() => {
    if (localSearch === search) return
    const t = setTimeout(() => setSearch(localSearch), 300)
    return () => clearTimeout(t)
  }, [localSearch, search, setSearch])

  if (!selectedPopupId) return null

  return (
    <div className="space-y-3">
      <div className="relative w-full min-w-0 sm:max-w-xs">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search venues..."
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          className="pl-9 pr-8"
        />
        {localSearch && (
          <button
            type="button"
            onClick={() => setLocalSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <VenuesGridView popupId={selectedPopupId} search={search} />
    </div>
  )
}

function VenueRowActions({ venue }: { venue: EventVenuePublic }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { isAdmin } = useAuth()

  const approveMutation = useMutation({
    mutationFn: () =>
      EventVenuesService.updateVenue({
        venueId: venue.id,
        requestBody: { status: "active" },
      }),
    onSuccess: () => showSuccessToast("Venue approved"),
    onError: createErrorHandler(showErrorToast),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["event-venues"] }),
  })

  const isPending = venue.status === "pending"

  return (
    <div className="flex items-center justify-end gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Schedule venue"
        title="Schedule"
        onClick={(e) => {
          e.stopPropagation()
          navigate({
            to: "/events/venues/$venueId/schedule",
            params: { venueId: venue.id },
          })
        }}
      >
        <CalendarRange className="h-4 w-4" />
      </Button>
      {isAdmin && isPending && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Approve venue"
          title="Approve"
          disabled={approveMutation.isPending}
          onClick={(e) => {
            e.stopPropagation()
            approveMutation.mutate()
          }}
        >
          <Check className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}

interface VenueRowProps {
  venue: EventVenuePublic
  dndEnabled: boolean
  onRowClick: (venue: EventVenuePublic) => void
}

function VenueRow({ venue, dndEnabled, onRowClick }: VenueRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: venue.id, disabled: !dndEnabled })

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  }

  const mode = venue.booking_mode

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={cn(
        "cursor-pointer",
        isDragging && "relative z-10 bg-background shadow-md",
      )}
      onClick={() => onRowClick(venue)}
    >
      <TableCell className="w-9 pr-0">
        {dndEnabled ? (
          <button
            type="button"
            className="flex h-8 w-8 cursor-grab items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:bg-muted hover:text-muted-foreground active:cursor-grabbing"
            aria-label={`Drag to reorder ${venue.title || "venue"}`}
            data-no-row-click
            onClick={(e) => e.stopPropagation()}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        ) : (
          <span className="flex h-8 w-8 items-center justify-center text-muted-foreground/20">
            <GripVertical className="h-4 w-4" />
          </span>
        )}
      </TableCell>
      <TableCell>
        <span className="font-medium">{venue.title || "Untitled venue"}</span>
      </TableCell>
      <TableCell>
        <StatusBadge
          status={venue.status === "pending" ? "pending" : "active"}
        />
      </TableCell>
      <TableCell>
        <span className="text-muted-foreground">{venue.location || "—"}</span>
      </TableCell>
      <TableCell>
        <span className="text-muted-foreground">{venue.capacity ?? "—"}</span>
      </TableCell>
      <TableCell>
        {mode ? (
          <Badge variant="outline">{BOOKING_MODE_LABELS[mode]}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <VenueRowActions venue={venue} />
      </TableCell>
    </TableRow>
  )
}

function VenuesTableContent() {
  const navigate = useNavigate()
  const searchParams = Route.useSearch()
  const { selectedPopupId } = useWorkspace()
  const { search, setSearch } = useTableSearchParams(
    searchParams,
    "/events/venues/",
  )
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const [pendingOnly, setPendingOnly] = useState(false)
  const [orderedRows, setOrderedRows] = useState<EventVenuePublic[]>([])
  // Debounced local search so the URL/query don't update on every keystroke.
  const [localSearch, setLocalSearch] = useState(search)
  useEffect(() => setLocalSearch(search), [search])
  useEffect(() => {
    if (localSearch === search) return
    const t = setTimeout(() => setSearch(localSearch), 300)
    return () => clearTimeout(t)
  }, [localSearch, search, setSearch])

  const { data: venues } = useQuery({
    queryKey: ["event-venues", { popupId: selectedPopupId, search }],
    queryFn: () =>
      EventVenuesService.listVenues({
        popupId: selectedPopupId!,
        search: search || undefined,
        skip: 0,
        limit: 500,
      }),
    enabled: !!selectedPopupId,
  })

  const rows = venues?.results ?? []
  const pendingCount = useMemo(
    () => rows.filter((v) => v.status === "pending").length,
    [rows],
  )
  const filtered = useMemo(
    () => (pendingOnly ? rows.filter((v) => v.status === "pending") : rows),
    [rows, pendingOnly],
  )

  // Sync the optimistic order to the server payload whenever it changes
  // (initial load, refetch after reorder, search/filter toggles).
  useEffect(() => {
    setOrderedRows(filtered)
  }, [filtered])

  const dndEnabled = !search && !pendingOnly

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const reorderMutation = useMutation({
    mutationFn: (venueIds: string[]) =>
      EventVenuesService.reorderVenues({
        requestBody: {
          popup_id: selectedPopupId!,
          venue_ids: venueIds,
        },
      }),
    onError: (err) => {
      // Revert optimistic order on failure.
      setOrderedRows(filtered)
      createErrorHandler(showErrorToast)(err as ApiError)
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["event-venues"] }),
  })

  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const oldIdx = orderedRows.findIndex((v) => v.id === e.active.id)
    const newIdx = orderedRows.findIndex((v) => v.id === e.over!.id)
    if (oldIdx === -1 || newIdx === -1) return
    const next = arrayMove(orderedRows, oldIdx, newIdx)
    setOrderedRows(next)
    reorderMutation.mutate(next.map((v) => v.id))
  }

  if (!venues) return <Skeleton className="h-64 w-full" />

  const showEmptyState = orderedRows.length === 0
  const filterActive = !!search || pendingOnly
  const goToEdit = (v: EventVenuePublic) =>
    navigate({
      to: "/events/venues/$venueId/edit",
      params: { venueId: v.id },
    })

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="relative w-full min-w-0 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search venues..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-9 pr-8"
          />
          {localSearch && (
            <button
              type="button"
              onClick={() => setLocalSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
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

      {filterActive && (
        <p className="text-xs text-muted-foreground">
          Clear filters to reorder venues.
        </p>
      )}

      {showEmptyState ? (
        !search ? (
          <EmptyState
            icon={MapPin}
            title={pendingOnly ? "No pending venues" : "No venues yet"}
            description={
              pendingOnly
                ? "Venues awaiting approval will appear here."
                : "Venues will appear here when created."
            }
          />
        ) : (
          <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
            No venues match your search.
          </div>
        )
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-9 pr-0">
                    <span className="sr-only">Reorder</span>
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Booking</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <SortableContext
                  items={orderedRows.map((v) => v.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {orderedRows.map((venue) => (
                    <VenueRow
                      key={venue.id}
                      venue={venue}
                      dndEnabled={dndEnabled}
                      onRowClick={goToEdit}
                    />
                  ))}
                </SortableContext>
              </TableBody>
            </Table>
          </div>
        </DndContext>
      )}
    </div>
  )
}

function VenuesPage() {
  const { selectedPopupId } = useWorkspace()
  const navigate = useNavigate()
  const searchParams = Route.useSearch()
  const view: VenuesView = searchParams.view ?? readStoredVenuesView() ?? "grid"

  const setView = (next: VenuesView) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VENUES_VIEW_STORAGE_KEY, next)
    }
    navigate({
      to: "/events/venues",
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        view: next,
      }),
      replace: true,
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Venues</h1>
          <p className="text-muted-foreground">
            Manage event venues for the selected pop-up
          </p>
        </div>
        {selectedPopupId && (
          <div className="flex items-center gap-2">
            <VenuesViewSwitcher view={view} onViewChange={setView} />
            <Button asChild>
              <Link to="/events/venues/new">
                <Plus className="mr-2 h-4 w-4" />
                Add Venue
              </Link>
            </Button>
          </div>
        )}
      </div>
      {selectedPopupId ? (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            {view === "grid" ? <VenuesGridContent /> : <VenuesTableContent />}
          </Suspense>
        </QueryErrorBoundary>
      ) : (
        <WorkspaceAlert resource="venues" />
      )}
    </div>
  )
}
