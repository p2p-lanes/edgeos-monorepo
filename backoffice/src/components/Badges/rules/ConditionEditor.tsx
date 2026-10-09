import { useQuery } from "@tanstack/react-query"
import { Check, Plus, Trash2, X } from "lucide-react"
import { useMemo, useState } from "react"

import {
  type BadgeRuleFilters,
  BadgesService,
  EventsService,
  EventVenuesService,
  type RuleActivity,
  type RuleMeasure,
  TracksService,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { DatePicker } from "@/components/ui/date-picker"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TimePicker } from "@/components/ui/time-picker"
import { cn } from "@/lib/utils"
import {
  ACTIVITY_LABELS,
  type Condition,
  MEASURE_LABELS,
  WEEKDAYS,
} from "./ruleText"

interface Option {
  value: string
  label: string
}

/** Chips for what's picked, plus a searchable popover to pick more. */
function MultiPick({
  options,
  value,
  onChange,
  placeholder,
  emptyMessage = "Nothing to pick yet.",
}: {
  options: Option[]
  value: string[]
  onChange: (value: string[]) => void
  placeholder: string
  emptyMessage?: string
}) {
  const [open, setOpen] = useState(false)
  const labels = useMemo(
    () => new Map(options.map((o) => [o.value, o.label])),
    [options],
  )
  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])

  return (
    <div className="flex flex-wrap items-center gap-1">
      {value.map((v) => (
        <Badge key={v} variant="secondary" className="gap-1">
          {labels.get(v) ?? v}
          <button
            type="button"
            aria-label={`Remove ${labels.get(v) ?? v}`}
            onClick={() => toggle(v)}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2">
            <Plus className="mr-1 h-3 w-3" />
            {placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search…" />
            <CommandList>
              <CommandEmpty>{emptyMessage}</CommandEmpty>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.value}`}
                  onSelect={() => toggle(o.value)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value.includes(o.value) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {o.label}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

export type FilterKey =
  | "tracks"
  | "tags"
  | "kinds"
  | "venues"
  | "events"
  | "weekdays"
  | "time"
  | "dates"

const FILTER_LABELS: Record<FilterKey, string> = {
  tracks: "Track",
  tags: "Tag",
  kinds: "Event type",
  venues: "Venue",
  events: "Specific events",
  weekdays: "Days of the week",
  time: "Time of day",
  dates: "Date range",
}

// Filters whose choices come from a gathering need one picked first.
const NEEDS_POPUP: FilterKey[] = ["tracks", "tags", "kinds", "venues", "events"]
// Of those, the ones holding ids that belong to the gathering. Tags and
// event types are plain names, so they survive switching gatherings.
const POPUP_OWNED: FilterKey[] = ["tracks", "venues", "events"]

/** Which filter rows a saved condition should open with. */
export function filtersInUse(
  filters: BadgeRuleFilters | undefined,
): FilterKey[] {
  if (!filters) return []
  const used: FilterKey[] = []
  if (filters.track_ids?.length) used.push("tracks")
  if (filters.tags?.length) used.push("tags")
  if (filters.kinds?.length) used.push("kinds")
  if (filters.venue_ids?.length) used.push("venues")
  if (filters.event_ids?.length) used.push("events")
  if (filters.weekdays?.length) used.push("weekdays")
  if (filters.starts_after || filters.starts_before) used.push("time")
  if (filters.date_from || filters.date_to) used.push("dates")
  return used
}

/** Clears what a filter row set, for when the row is removed. */
function clearFilter(f: BadgeRuleFilters, key: FilterKey): BadgeRuleFilters {
  switch (key) {
    case "tracks":
      return { ...f, track_ids: [] }
    case "tags":
      return { ...f, tags: [], tags_match: "any" }
    case "kinds":
      return { ...f, kinds: [] }
    case "venues":
      return { ...f, venue_ids: [] }
    case "events":
      return { ...f, event_ids: [] }
    case "weekdays":
      return { ...f, weekdays: [] }
    case "time":
      return { ...f, starts_after: null, starts_before: null }
    case "dates":
      return { ...f, date_from: null, date_to: null }
  }
}

function usePopupChoices(popupId: string | null | undefined) {
  const enabled = !!popupId
  const id = popupId ?? ""
  const tracks = useQuery({
    queryKey: ["tracks", { popupId: id }],
    queryFn: () => TracksService.listTracks({ popupId: id, limit: 200 }),
    enabled,
  })
  const venues = useQuery({
    queryKey: ["event-venues", { popupId: id }],
    queryFn: () => EventVenuesService.listVenues({ popupId: id, limit: 200 }),
    enabled,
  })
  const events = useQuery({
    queryKey: ["events", "badge-rule-picker", id],
    queryFn: () => EventsService.listEvents({ popupId: id, limit: 500 }),
    enabled,
  })
  const options = useQuery({
    queryKey: ["badge-rules", "options", id],
    queryFn: () => BadgesService.badgeRuleOptions({ popupId: id }),
    enabled,
  })
  return {
    tracks: (tracks.data?.results ?? []).map((t) => ({
      value: t.id,
      label: t.name,
    })),
    venues: (venues.data?.results ?? []).map((v) => ({
      value: v.id,
      label: v.title,
    })),
    events: (events.data?.results ?? []).map((e) => ({
      value: e.id,
      label: `${e.title} · ${new Date(e.start_time).toLocaleDateString()}`,
    })),
    tags: (options.data?.tags ?? []).map((t) => ({ value: t, label: t })),
    kinds: (options.data?.kinds ?? []).map((k) => ({ value: k, label: k })),
  }
}

function FilterRow({
  label,
  onRemove,
  children,
}: {
  label: string
  onRemove: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-28 shrink-0 pt-1.5 text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        aria-label={`Remove ${label} filter`}
        onClick={onRemove}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

export function ConditionEditor({
  index,
  condition,
  shown,
  popups,
  onChange,
  onShownChange,
  onRemove,
}: {
  index: number
  condition: Condition
  shown: FilterKey[]
  popups: (Option & { badgesOff?: boolean })[]
  onChange: (condition: Condition) => void
  onShownChange: (shown: FilterKey[]) => void
  onRemove?: () => void
}) {
  const filters = condition.filters ?? {}
  const choices = usePopupChoices(filters.popup_id)
  const setFilters = (patch: Partial<BadgeRuleFilters>) =>
    onChange({ ...condition, filters: { ...filters, ...patch } })
  const available = (Object.keys(FILTER_LABELS) as FilterKey[]).filter(
    (k) => !shown.includes(k),
  )
  const hide = (key: FilterKey) => {
    onShownChange(shown.filter((k) => k !== key))
    onChange({ ...condition, filters: clearFilter(filters, key) })
  }
  const thresholdId = `rule-threshold-${index}`

  const renderFilter = (key: FilterKey) => {
    const row = (children: React.ReactNode) => (
      <FilterRow
        key={key}
        label={FILTER_LABELS[key]}
        onRemove={() => hide(key)}
      >
        {children}
      </FilterRow>
    )
    switch (key) {
      case "tracks":
        return row(
          <MultiPick
            options={choices.tracks}
            value={filters.track_ids ?? []}
            onChange={(track_ids) => setFilters({ track_ids })}
            placeholder="Add track"
            emptyMessage="This gathering has no tracks."
          />,
        )
      case "tags":
        return row(
          <div className="space-y-1">
            {(filters.tags?.length ?? 0) > 1 && (
              <Select
                value={filters.tags_match ?? "any"}
                onValueChange={(v) =>
                  setFilters({ tags_match: v as "any" | "all" })
                }
              >
                <SelectTrigger className="h-7 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any of these</SelectItem>
                  <SelectItem value="all">All of these</SelectItem>
                </SelectContent>
              </Select>
            )}
            <MultiPick
              options={choices.tags}
              value={filters.tags ?? []}
              onChange={(tags) => setFilters({ tags })}
              placeholder="Add tag"
              emptyMessage="No events in this gathering use tags yet."
            />
          </div>,
        )
      case "kinds":
        return row(
          <MultiPick
            options={choices.kinds}
            value={filters.kinds ?? []}
            onChange={(kinds) => setFilters({ kinds })}
            placeholder="Add type"
            emptyMessage="No event types in this gathering yet."
          />,
        )
      case "venues":
        return row(
          <MultiPick
            options={choices.venues}
            value={filters.venue_ids ?? []}
            onChange={(venue_ids) => setFilters({ venue_ids })}
            placeholder="Add venue"
            emptyMessage="This gathering has no venues."
          />,
        )
      case "events":
        return row(
          <MultiPick
            options={choices.events}
            value={filters.event_ids ?? []}
            onChange={(event_ids) => setFilters({ event_ids })}
            placeholder="Add event"
            emptyMessage="No events found."
          />,
        )
      case "weekdays":
        return row(
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((name, i) => {
              const day = i + 1
              const on = filters.weekdays?.includes(day) ?? false
              return (
                <Button
                  key={name}
                  type="button"
                  size="sm"
                  variant={on ? "default" : "outline"}
                  className="h-7 w-11 px-0 text-xs"
                  aria-pressed={on}
                  onClick={() =>
                    setFilters({
                      weekdays: on
                        ? (filters.weekdays ?? []).filter((d) => d !== day)
                        : [...(filters.weekdays ?? []), day].sort(),
                    })
                  }
                >
                  {name}
                </Button>
              )
            })}
          </div>,
        )
      case "time":
        return row(
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            starts from
            <TimePicker
              value={filters.starts_after?.slice(0, 5) ?? ""}
              onChange={(v) => setFilters({ starts_after: v || null })}
              step={15}
            />
            and before
            <TimePicker
              value={filters.starts_before?.slice(0, 5) ?? ""}
              onChange={(v) => setFilters({ starts_before: v || null })}
              step={15}
            />
          </div>,
        )
      case "dates":
        return row(
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            from
            <DatePicker
              value={filters.date_from ?? ""}
              onChange={(v) => setFilters({ date_from: v || null })}
              placeholder="Any start"
              className="w-40"
            />
            to
            <DatePicker
              value={filters.date_to ?? ""}
              onChange={(v) => setFilters({ date_to: v || null })}
              placeholder="Any end"
              className="w-40"
            />
          </div>,
        )
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={condition.activity ?? "attend"}
          onValueChange={(v) =>
            onChange({ ...condition, activity: v as RuleActivity })
          }
        >
          <SelectTrigger className="w-40" aria-label="Activity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ACTIVITY_LABELS) as RuleActivity[]).map((a) => (
              <SelectItem key={a} value={a}>
                {ACTIVITY_LABELS[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label htmlFor={thresholdId} className="sr-only">
          How many
        </Label>
        <Input
          id={thresholdId}
          type="number"
          min={1}
          max={1000}
          value={Number.isNaN(condition.threshold) ? "" : condition.threshold}
          onChange={(e) =>
            onChange({ ...condition, threshold: e.target.valueAsNumber })
          }
          className="w-20"
        />
        <Select
          value={condition.measure ?? "count"}
          onValueChange={(v) =>
            onChange({ ...condition, measure: v as RuleMeasure })
          }
        >
          <SelectTrigger className="w-40" aria-label="Measure">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(MEASURE_LABELS) as RuleMeasure[]).map((m) => (
              <SelectItem key={m} value={m}>
                {MEASURE_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto h-8 w-8"
            aria-label="Remove condition"
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <span className="w-28 shrink-0 pt-2 text-xs font-medium text-muted-foreground">
            Gathering
          </span>
          <Select
            value={filters.popup_id ?? "__any__"}
            onValueChange={(v) => {
              const popup_id = v === "__any__" ? null : v
              const cleared = POPUP_OWNED.reduce(clearFilter, filters)
              onChange({ ...condition, filters: { ...cleared, popup_id } })
              if (!popup_id) {
                onShownChange(shown.filter((k) => !POPUP_OWNED.includes(k)))
              }
            }}
          >
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__any__">
                Any gathering with badges on
              </SelectItem>
              {popups.map((p) => (
                <SelectItem
                  key={p.value}
                  value={p.value}
                  // Check-ins there never count; one already picked stays.
                  disabled={p.badgesOff && p.value !== filters.popup_id}
                >
                  {p.label}
                  {p.badgesOff && " (badges off)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {shown.map(renderFilter)}
      </div>

      {available.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add filter
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {available.map((key) => {
              const locked = NEEDS_POPUP.includes(key) && !filters.popup_id
              return (
                <DropdownMenuItem
                  key={key}
                  disabled={locked}
                  onSelect={() => onShownChange([...shown, key])}
                >
                  {FILTER_LABELS[key]}
                  {locked && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      pick a gathering
                    </span>
                  )}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
