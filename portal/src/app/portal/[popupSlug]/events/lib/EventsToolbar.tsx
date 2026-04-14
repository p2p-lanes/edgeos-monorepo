"use client"

import {
  CalendarDays,
  CheckCircle,
  Layers,
  List,
  Plus,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface EventsToolbarProps {
  slug: string | undefined
  view: "list" | "calendar"
  rsvpedOnly: boolean
  onRsvpedOnlyChange: (value: boolean) => void
  canCreate: boolean
}

/**
 * Shared action bar used by the events list and calendar pages. Keeps the
 * filter + navigation controls in the same visual position so swapping
 * between views feels stable.
 */
export function EventsToolbar({
  slug,
  view,
  rsvpedOnly,
  onRsvpedOnlyChange,
  canCreate,
}: EventsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant={rsvpedOnly ? "default" : "outline"}
        size="sm"
        onClick={() => onRsvpedOnlyChange(!rsvpedOnly)}
        aria-pressed={rsvpedOnly}
      >
        <CheckCircle className="mr-2 h-4 w-4" />
        My RSVPs
      </Button>

      <Button variant="outline" size="sm" asChild>
        <Link href={`/portal/${slug}/events/tracks`}>
          <Layers className="mr-2 h-4 w-4" />
          Tracks
        </Link>
      </Button>

      {/* Segmented List / Calendar switcher — same spot on both pages. */}
      <div className="inline-flex rounded-md border bg-card p-0.5">
        <Button
          variant={view === "list" ? "default" : "ghost"}
          size="sm"
          asChild
          className={cn(
            "h-7 rounded-sm",
            view === "list" && "shadow-none",
          )}
        >
          <Link href={`/portal/${slug}/events`}>
            <List className="mr-1.5 h-4 w-4" />
            List
          </Link>
        </Button>
        <Button
          variant={view === "calendar" ? "default" : "ghost"}
          size="sm"
          asChild
          className={cn(
            "h-7 rounded-sm",
            view === "calendar" && "shadow-none",
          )}
        >
          <Link href={`/portal/${slug}/events/calendar`}>
            <CalendarDays className="mr-1.5 h-4 w-4" />
            Calendar
          </Link>
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
