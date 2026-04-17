"use client"

import {
  CalendarDays,
  CheckCircle,
  Eye,
  EyeOff,
  Filter,
  List,
  Pencil,
  Plus,
  Search,
} from "lucide-react"
import Link from "next/link"
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
  slug: string | undefined
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
  showHidden,
  onShowHiddenChange,
  hiddenCount,
  allowedTags,
  selectedTags,
  onSelectedTagsChange,
  canCreate,
}: EventsToolbarProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[200px]">
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
      >
        <CheckCircle className="mr-2 h-4 w-4" />
        {t("events.toolbar.my_rsvps")}
      </Button>

      <Button
        variant={mineOnly ? "default" : "outline"}
        size="sm"
        onClick={() => onMineOnlyChange(!mineOnly)}
        aria-pressed={mineOnly}
      >
        <Pencil className="mr-2 h-4 w-4" />
        {t("events.toolbar.my_events")}
      </Button>

      {onShowHiddenChange && (
        <Button
          variant={showHidden ? "default" : "outline"}
          size="sm"
          onClick={() => onShowHiddenChange(!showHidden)}
          aria-pressed={!!showHidden}
          title={
            showHidden
              ? t("events.toolbar.hidden_title_showing")
              : t("events.toolbar.hidden_title_hidden")
          }
          disabled={!showHidden && (hiddenCount ?? 0) === 0}
        >
          {showHidden ? (
            <EyeOff className="mr-2 h-4 w-4" />
          ) : (
            <Eye className="mr-2 h-4 w-4" />
          )}
          {t("events.toolbar.hidden")}
          {typeof hiddenCount === "number" && hiddenCount > 0 && (
            <span className="ml-1.5 text-xs opacity-80">({hiddenCount})</span>
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
            >
              <Filter className="mr-2 h-4 w-4" />
              {t("events.toolbar.tags_label")}
              {selectedTags && selectedTags.length > 0 && (
                <span className="ml-1.5 text-xs opacity-80">
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
          swaps. Active option shows label + icon, inactive is icon-only. */}
      <div className="inline-flex rounded-md border bg-card p-0.5">
        <Button
          type="button"
          variant={view === "list" ? "default" : "ghost"}
          size="sm"
          aria-label={t("events.toolbar.list_view_label")}
          title={t("events.toolbar.list_view_label")}
          aria-pressed={view === "list"}
          onClick={() => onViewChange("list")}
          className={cn("h-7 rounded-sm", view === "list" && "shadow-none")}
        >
          <List className={cn("h-4 w-4", view === "list" && "mr-1.5")} />
          {view === "list" && (
            <span>{t("events.toolbar.list_view_short")}</span>
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
          className={cn("h-7 rounded-sm", view === "calendar" && "shadow-none")}
        >
          <CalendarDays
            className={cn("h-4 w-4", view === "calendar" && "mr-1.5")}
          />
          {view === "calendar" && (
            <span>{t("events.toolbar.calendar_view_short")}</span>
          )}
        </Button>
      </div>

      {canCreate && (
        <Button size="sm" asChild>
          <Link href={`/portal/${slug}/events/new`}>
            <Plus className="mr-2 h-4 w-4" />
            {t("events.toolbar.create_event")}
          </Link>
        </Button>
      )}
    </div>
  )
}
