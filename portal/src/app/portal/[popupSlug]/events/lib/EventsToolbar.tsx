"use client"

import {
  CalendarDays,
  CheckCircle,
  Crown,
  Eye,
  EyeOff,
  Filter,
  List,
  Search,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface EventsToolbarProps {
  view: "list" | "calendar"
  onViewChange: (view: "list" | "calendar") => void
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
        onClick={() => onRsvpedOnlyChange(!rsvpedOnly)}
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
        onClick={() => onMineOnlyChange(!mineOnly)}
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
            <div className="flex flex-wrap gap-1.5">
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
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
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

      {/* Segmented List / Calendar switcher — same page, only the body
          swaps. Active option shows label + icon on sm+, icon-only on mobile
          (the active background still marks the current view). */}
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
            "h-7 rounded-sm px-2 sm:px-3",
            view === "list" && "shadow-none",
          )}
        >
          <List className={cn("h-4 w-4", view === "list" && "sm:mr-1.5")} />
          {view === "list" && (
            <span className="hidden sm:inline">
              {t("events.toolbar.list_view_short")}
            </span>
          )}
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
            "h-7 rounded-sm px-2 sm:px-3",
            view === "calendar" && "shadow-none",
          )}
        >
          <CalendarDays
            className={cn("h-4 w-4", view === "calendar" && "sm:mr-1.5")}
          />
          {view === "calendar" && (
            <span className="hidden sm:inline">
              {t("events.toolbar.calendar_view_short")}
            </span>
          )}
        </Button>
      </div>
    </div>
  )
}
