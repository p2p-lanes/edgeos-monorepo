import { CalendarClock, CalendarDays, Table } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type EventsView = "table" | "calendar" | "day"

interface EventsViewSwitcherProps {
  view: EventsView
  onViewChange: (view: EventsView) => void
  className?: string
}

export function EventsViewSwitcher({
  view,
  onViewChange,
  className,
}: EventsViewSwitcherProps) {
  return (
    <div
      className={cn("inline-flex rounded-md border bg-card p-0.5", className)}
    >
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
        <Table className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant={view === "calendar" ? "default" : "ghost"}
        size="sm"
        aria-label="Calendar"
        title="Calendar"
        aria-pressed={view === "calendar"}
        onClick={() => onViewChange("calendar")}
        className={cn(
          "h-7 w-7 rounded-sm p-0",
          view === "calendar" && "shadow-none",
        )}
      >
        <CalendarDays className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant={view === "day" ? "default" : "ghost"}
        size="sm"
        aria-label="Day"
        title="Day"
        aria-pressed={view === "day"}
        onClick={() => onViewChange("day")}
        className={cn(
          "h-7 w-7 rounded-sm p-0",
          view === "day" && "shadow-none",
        )}
      >
        <CalendarClock className="h-4 w-4" />
      </Button>
    </div>
  )
}
