"use client"

import { Home, Video } from "lucide-react"
import { memo, useMemo } from "react"
import { useTranslation } from "react-i18next"
import type { EventVenuePublic } from "@/client"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface VenueSelectProps {
  venueId: string
  onVenueChange: (next: string) => void
  venues: EventVenuePublic[]
  /**
   * Label to use when `venueId` is set but the matching venue isn't in
   * `venues` yet (edit page first paint, or a soft-deleted venue). Without
   * this we fall back to `events.venues.list.untitled_venue`.
   */
  selectedVenueLabel?: string
}

// Virtual meeting is an explicit choice, not the default: an empty
// `venueId` means "nothing picked yet" and renders the placeholder.
const MEETING_VALUE = "__meeting__"
const CUSTOM_VALUE = "__custom__"

function VenueSelectImpl({
  venueId,
  onVenueChange,
  venues,
  selectedVenueLabel,
}: VenueSelectProps) {
  const { t } = useTranslation()

  // Build venue dropdown items separately from the two synthetic options
  // (Meeting + Custom location), which always sit at the top of the list
  // with a visual separator and an icon to distinguish them from real
  // venues. The currently selected venue is included exactly once: from
  // `venues` when present, or as a stub using `selectedVenueLabel` while
  // the list query is still resolving.
  const venueItems = useMemo(() => {
    const out: { value: string; label: string }[] = []
    const seen = new Set<string>([MEETING_VALUE, CUSTOM_VALUE])

    const formatVenueLabel = (v: EventVenuePublic) => {
      const title = v.title || t("events.venues.list.untitled_venue")
      return v.capacity
        ? `${title}${t("events.form.venue_capacity_suffix", {
            capacity: v.capacity,
          })}`
        : title
    }

    if (
      venueId &&
      venueId !== CUSTOM_VALUE &&
      venueId !== MEETING_VALUE &&
      !venues.some((v) => v.id === venueId)
    ) {
      out.push({
        value: venueId,
        label: selectedVenueLabel || t("events.venues.list.untitled_venue"),
      })
      seen.add(venueId)
    }

    for (const v of venues) {
      if (seen.has(v.id)) continue
      out.push({ value: v.id, label: formatVenueLabel(v) })
      seen.add(v.id)
    }

    return out
  }, [venueId, venues, selectedVenueLabel, t])

  // Render the trigger label ourselves instead of relying on `<SelectValue>`.
  // Radix's Value reads the label from a registered `<SelectItem>` whose
  // value matches `Select.value` — but `<SelectContent>` lives inside a
  // Portal that only mounts while the dropdown is open, so on the very
  // first paint of the edit page no items are registered and the trigger
  // falls back to its placeholder ("No venue"). Computing the label
  // ourselves and dropping it straight into the trigger sidesteps that
  // entire mechanism.
  const triggerLabel =
    venueId === CUSTOM_VALUE
      ? t("events.form.custom_location_option")
      : venueId === MEETING_VALUE
        ? t("events.form.no_venue_option")
        : !venueId
          ? t("events.form.venue_where_placeholder")
          : (venueItems.find((i) => i.value === venueId)?.label ??
            t("events.form.venue_placeholder"))

  return (
    <Select value={venueId} onValueChange={onVenueChange}>
      <SelectTrigger className="w-full">
        <span
          className={cn(
            "truncate text-left",
            !venueId && "text-muted-foreground",
          )}
        >
          {triggerLabel}
        </span>
      </SelectTrigger>
      <SelectContent className="max-h-[min(20rem,60svh)]">
        <SelectItem
          value={MEETING_VALUE}
          className={cn(
            "data-[highlighted]:bg-muted",
            "bg-muted/40 text-foreground",
          )}
        >
          <span className="inline-flex items-center gap-2">
            <Video className="h-3.5 w-3.5 text-muted-foreground" />
            {t("events.form.no_venue_option")}
          </span>
        </SelectItem>
        <SelectItem
          value={CUSTOM_VALUE}
          className={cn(
            "data-[highlighted]:bg-muted",
            "bg-muted/40 text-foreground",
          )}
        >
          <span className="inline-flex items-center gap-2">
            <Home className="h-3.5 w-3.5 text-muted-foreground" />
            {t("events.form.custom_location_option")}
          </span>
        </SelectItem>
        {venueItems.length > 0 && (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("events.form.venues_group_label")}
              </SelectLabel>
              {venueItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}
      </SelectContent>
    </Select>
  )
}

export const VenueSelect = memo(VenueSelectImpl)
