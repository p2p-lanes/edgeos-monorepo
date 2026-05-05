"use client"

import { CalendarClock, CalendarDays, List } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { EventsView } from "../types"

interface ViewSwitcherProps {
  view: EventsView
  onViewChange: (view: EventsView) => void
  className?: string
}

export function ViewSwitcher({
  view,
  onViewChange,
  className,
}: ViewSwitcherProps) {
  const { t } = useTranslation()
  return (
    <div
      className={cn("inline-flex rounded-md border bg-card p-0.5", className)}
    >
      <Button
        type="button"
        variant={view === "list" ? "default" : "ghost"}
        size="sm"
        aria-label={t("events.toolbar.list_view_label")}
        title={t("events.toolbar.list_view_label")}
        aria-pressed={view === "list"}
        onClick={() => onViewChange("list")}
        className={cn(
          "h-7 w-7 rounded-sm p-0",
          view === "list" && "shadow-none",
        )}
      >
        <List className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant={view === "calendar" ? "default" : "ghost"}
        size="sm"
        aria-label={t("events.toolbar.calendar_view_label")}
        title={t("events.toolbar.calendar_view_label")}
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
        aria-label={t("events.toolbar.day_view_label")}
        title={t("events.toolbar.day_view_label")}
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
