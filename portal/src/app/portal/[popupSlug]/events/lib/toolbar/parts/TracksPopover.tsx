"use client"

import { Layers } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { TrackPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface TracksPopoverProps {
  allowedTracks: TrackPublic[]
  selectedTrackIds: string[]
  onChange: (ids: string[]) => void
  triggerClassName?: string
}

export function TracksPopover({
  allowedTracks,
  selectedTrackIds,
  onChange,
  triggerClassName,
}: TracksPopoverProps) {
  const { t } = useTranslation()
  const count = selectedTrackIds.length
  const active = count > 0

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={active ? "default" : "outline"}
          size="sm"
          title={t("events.toolbar.filter_by_tracks")}
          aria-label={t("events.toolbar.tracks_label")}
          className={cn("px-2 sm:px-3", triggerClassName)}
        >
          <Layers className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">
            {t("events.toolbar.tracks_label")}
          </span>
          {active && <span className="ml-1 text-xs opacity-80">({count})</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("events.toolbar.filter_by_track_label")}
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
          {allowedTracks.map((track) => {
            const isActive = selectedTrackIds.includes(track.id)
            return (
              <button
                key={track.id}
                type="button"
                onClick={() => {
                  onChange(
                    isActive
                      ? selectedTrackIds.filter((x) => x !== track.id)
                      : [...selectedTrackIds, track.id],
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
                {track.name}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
