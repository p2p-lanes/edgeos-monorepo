"use client"

import { MapPin } from "lucide-react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface VenuesPopoverProps {
  allowedVenues: { id: string; name: string }[]
  selectedVenueIds: string[]
  onChange: (ids: string[]) => void
  triggerClassName?: string
}

export function VenuesPopover({
  allowedVenues,
  selectedVenueIds,
  onChange,
  triggerClassName,
}: VenuesPopoverProps) {
  const { t } = useTranslation()
  const count = selectedVenueIds.length
  const active = count > 0
  const sortedVenues = useMemo(
    () =>
      [...allowedVenues].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    [allowedVenues],
  )

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={active ? "default" : "outline"}
          size="sm"
          title={t("events.toolbar.filter_by_venues")}
          aria-label={t("events.toolbar.venues_label")}
          className={cn("px-2 sm:px-3", triggerClassName)}
        >
          <MapPin className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">
            {t("events.toolbar.venues_label")}
          </span>
          {active && <span className="ml-1 text-xs opacity-80">({count})</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("events.toolbar.filter_by_venue_label")}
          </span>
          {active && (
            <button
              type="button"
              className="text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => onChange([])}
            >
              {t("events.toolbar.clear_filters")}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {sortedVenues.map((venue) => {
            const isActive = selectedVenueIds.includes(venue.id)
            return (
              <button
                key={venue.id}
                type="button"
                onClick={() => {
                  onChange(
                    isActive
                      ? selectedVenueIds.filter((x) => x !== venue.id)
                      : [...selectedVenueIds, venue.id],
                  )
                }}
                aria-pressed={isActive}
                className={cn(
                  "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium leading-none shadow-sm transition-colors",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border-input bg-background text-foreground hover:bg-muted",
                )}
              >
                {venue.name}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
