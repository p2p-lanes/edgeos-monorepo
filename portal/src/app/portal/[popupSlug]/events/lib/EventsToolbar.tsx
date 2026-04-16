"use client"

import {
  CalendarDays,
  CheckCircle,
  Layers,
  List,
  MapPin,
  Pencil,
  Plus,
  Search,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface EventsToolbarProps {
  slug: string | undefined
  view: "list" | "calendar"
  onViewChange: (view: "list" | "calendar") => void
  search: string
  onSearchChange: (value: string) => void
  rsvpedOnly: boolean
  onRsvpedOnlyChange: (value: boolean) => void
  mineOnly: boolean
  onMineOnlyChange: (value: boolean) => void
  canCreate: boolean
}

/**
 * Shared action bar used by the events list and calendar pages. Keeps the
 * search input AND the actions in identical positions across views so
 * only the body below changes when you switch.
 */
export function EventsToolbar({
  slug,
  view,
  onViewChange,
  search,
  onSearchChange,
  rsvpedOnly,
  onRsvpedOnlyChange,
  mineOnly,
  onMineOnlyChange,
  canCreate,
}: EventsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search events..."
          className="pl-9"
        />
      </div>

      <Button
        variant={rsvpedOnly ? "default" : "outline"}
        size="sm"
        onClick={() => onRsvpedOnlyChange(!rsvpedOnly)}
        aria-pressed={rsvpedOnly}
      >
        <CheckCircle className="mr-2 h-4 w-4" />
        My RSVPs
      </Button>

      <Button
        variant={mineOnly ? "default" : "outline"}
        size="sm"
        onClick={() => onMineOnlyChange(!mineOnly)}
        aria-pressed={mineOnly}
      >
        <Pencil className="mr-2 h-4 w-4" />
        My events
      </Button>

      <Button variant="outline" size="sm" asChild>
        <Link href={`/portal/${slug}/events/venues`}>
          <MapPin className="mr-2 h-4 w-4" />
          Venues
        </Link>
      </Button>

      <Button variant="outline" size="sm" asChild>
        <Link href={`/portal/${slug}/events/tracks`}>
          <Layers className="mr-2 h-4 w-4" />
          Tracks
        </Link>
      </Button>

      {/* Segmented List / Calendar switcher — same page, only the body
          swaps. Active option shows label + icon, inactive is icon-only. */}
      <div className="inline-flex rounded-md border bg-card p-0.5">
        <Button
          type="button"
          variant={view === "list" ? "default" : "ghost"}
          size="sm"
          aria-label="List view"
          title="List view"
          aria-pressed={view === "list"}
          onClick={() => onViewChange("list")}
          className={cn("h-7 rounded-sm", view === "list" && "shadow-none")}
        >
          <List className={cn("h-4 w-4", view === "list" && "mr-1.5")} />
          {view === "list" && <span>List</span>}
        </Button>
        <Button
          type="button"
          variant={view === "calendar" ? "default" : "ghost"}
          size="sm"
          aria-label="Calendar view"
          title="Calendar view"
          aria-pressed={view === "calendar"}
          onClick={() => onViewChange("calendar")}
          className={cn("h-7 rounded-sm", view === "calendar" && "shadow-none")}
        >
          <CalendarDays
            className={cn("h-4 w-4", view === "calendar" && "mr-1.5")}
          />
          {view === "calendar" && <span>Calendar</span>}
        </Button>
      </div>

      {canCreate && (
        <Button size="sm" asChild>
          <Link href={`/portal/${slug}/events/new`}>
            <Plus className="mr-2 h-4 w-4" />
            Create event
          </Link>
        </Button>
      )}
    </div>
  )
}
