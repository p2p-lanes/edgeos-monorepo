"use client"

import {
  CalendarClock,
  CalendarDays,
  CheckCircle,
  Crown,
  Eye,
  EyeOff,
  Filter,
  Layers,
  List,
  Search,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import type { TrackPublic } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type EventsView = "list" | "calendar" | "day"

interface EventsToolbarProps {
  view: EventsView
  onViewChange: (view: EventsView) => void
  search: string
  onSearchChange: (value: string) => void
  rsvpedOnly: boolean
  onRsvpedOnlyChange: (value: boolean) => void
  mineOnly: boolean
  onMineOnlyChange: (value: boolean) => void
  showHidden?: boolean
  onShowHiddenChange?: (value: boolean) => void
  hiddenCount?: number
  allowedTags?: string[]
  selectedTags?: string[]
  onSelectedTagsChange?: (tags: string[]) => void
  allowedTracks?: TrackPublic[]
  selectedTrackIds?: string[]
  onSelectedTrackIdsChange?: (ids: string[]) => void
}

/**
 * Shared action bar used by the events list and calendar pages. Keeps the
 * search input AND the actions in identical positions across views so
 * only the body below changes when you switch.
 */
export function EventsToolbar({
  view,
  onViewChange,
  search,
  onSearchChange,
  rsvpedOnly,
  onRsvpedOnlyChange,
  mineOnly,
  onMineOnlyChange,
  showHidden,
  onShowHiddenChange,
  hiddenCount,
  allowedTags,
  selectedTags,
  onSelectedTagsChange,
  allowedTracks,
  selectedTrackIds,
  onSelectedTrackIdsChange,
}: EventsToolbarProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
      <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("events.toolbar.search_placeholder")}
          className="pl-9"
        />
      </div>

      <Button
        variant={rsvpedOnly ? "default" : "outline"}
        size="sm"
        onClick={() => {
          const next = !rsvpedOnly
          onRsvpedOnlyChange(next)
          if (next && mineOnly) onMineOnlyChange(false)
        }}
        aria-pressed={rsvpedOnly}
        aria-label={t("events.toolbar.my_rsvps")}
        title={t("events.toolbar.my_rsvps")}
        className="px-2 sm:px-3"
      >
        <CheckCircle className="h-4 w-4 sm:mr-2" />
        <span className="hidden sm:inline">{t("events.toolbar.my_rsvps")}</span>
      </Button>

      <Button
        variant={mineOnly ? "default" : "outline"}
        size="sm"
        onClick={() => {
          const next = !mineOnly
          onMineOnlyChange(next)
          if (next && rsvpedOnly) onRsvpedOnlyChange(false)
        }}
        aria-pressed={mineOnly}
        aria-label={t("events.toolbar.my_events")}
        title={t("events.toolbar.my_events")}
        className="px-2 sm:px-3"
      >
        <Crown className="h-4 w-4 sm:mr-2" />
        <span className="hidden sm:inline">
          {t("events.toolbar.my_events")}
        </span>
      </Button>

      {onShowHiddenChange && (
        <Button
          variant={showHidden ? "default" : "outline"}
          size="sm"
          onClick={() => onShowHiddenChange(!showHidden)}
          aria-pressed={!!showHidden}
          aria-label={t("events.toolbar.hidden")}
          title={
            showHidden
              ? t("events.toolbar.hidden_title_showing")
              : t("events.toolbar.hidden_title_hidden")
          }
          disabled={!showHidden && (hiddenCount ?? 0) === 0}
          className="px-2 sm:px-3"
        >
          {showHidden ? (
            <EyeOff className="h-4 w-4 sm:mr-2" />
          ) : (
            <Eye className="h-4 w-4 sm:mr-2" />
          )}
          <span className="hidden sm:inline">{t("events.toolbar.hidden")}</span>
          {typeof hiddenCount === "number" && hiddenCount > 0 && (
            <span className="ml-1 text-xs opacity-80">({hiddenCount})</span>
          )}
        </Button>
      )}

      {allowedTags && allowedTags.length > 0 && onSelectedTagsChange && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={
                selectedTags && selectedTags.length > 0 ? "default" : "outline"
              }
              size="sm"
              title={t("events.toolbar.filter_by_tags")}
              aria-label={t("events.toolbar.tags_label")}
              className="px-2 sm:px-3"
            >
              <Filter className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">
                {t("events.toolbar.tags_label")}
              </span>
              {selectedTags && selectedTags.length > 0 && (
                <span className="ml-1 text-xs opacity-80">
                  ({selectedTags.length})
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("events.toolbar.filter_by_tag_label")}
              </span>
              {selectedTags && selectedTags.length > 0 && (
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => onSelectedTagsChange([])}
                >
                  {t("events.toolbar.clear_filters")}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {allowedTags.map((t) => {
                const active = !!selectedTags?.includes(t)
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      const current = selectedTags ?? []
                      onSelectedTagsChange(
                        active
                          ? current.filter((x) => x !== t)
                          : [...current, t],
                      )
                    }}
                    aria-pressed={active}
                    className={cn(
                      "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium leading-none shadow-sm transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                        : "border-input bg-background text-foreground hover:bg-muted",
                    )}
                  >
                    {t}
                  </button>
                )
              })}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {allowedTracks &&
        allowedTracks.length > 0 &&
        onSelectedTrackIdsChange && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={
                  selectedTrackIds && selectedTrackIds.length > 0
                    ? "default"
                    : "outline"
                }
                size="sm"
                title={t("events.toolbar.filter_by_tracks")}
                aria-label={t("events.toolbar.tracks_label")}
                className="px-2 sm:px-3"
              >
                <Layers className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">
                  {t("events.toolbar.tracks_label")}
                </span>
                {selectedTrackIds && selectedTrackIds.length > 0 && (
                  <span className="ml-1 text-xs opacity-80">
                    ({selectedTrackIds.length})
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("events.toolbar.filter_by_track_label")}
                </span>
                {selectedTrackIds && selectedTrackIds.length > 0 && (
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => onSelectedTrackIdsChange([])}
                  >
                    {t("events.toolbar.clear_filters")}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {allowedTracks.map((track) => {
                  const active = !!selectedTrackIds?.includes(track.id)
                  return (
                    <button
                      key={track.id}
                      type="button"
                      onClick={() => {
                        const current = selectedTrackIds ?? []
                        onSelectedTrackIdsChange(
                          active
                            ? current.filter((x) => x !== track.id)
                            : [...current, track.id],
                        )
                      }}
                      aria-pressed={active}
                      className={cn(
                        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium leading-none shadow-sm transition-colors",
                        active
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
        )}

      {/* Segmented List / Calendar / Day switcher — icon-only. The active
          background marks the current view; titles/aria-labels carry the
          name for screen readers and tooltips. */}
      <div className="inline-flex rounded-md border bg-card p-0.5">
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
    </div>
  )
}
