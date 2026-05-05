"use client"

import { memo, useMemo } from "react"
import { useTranslation } from "react-i18next"
import type { EventVenuePublic } from "@/client"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"

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

const NONE_VALUE = "__none__"

function VenueSelectImpl({
  venueId,
  onVenueChange,
  venues,
  selectedVenueLabel,
}: VenueSelectProps) {
  const { t } = useTranslation()

  // Build the dropdown item list with one entry per unique value. The
  // currently selected venue is included exactly once: from `venues` when
  // present, or as a stub using `selectedVenueLabel` while the list query
  // is still resolving.
  const items = useMemo(() => {
    const out: { value: string; label: string }[] = [
      { value: NONE_VALUE, label: t("events.form.no_venue_option") },
    ]
    const seen = new Set<string>([NONE_VALUE])

    const formatVenueLabel = (v: EventVenuePublic) => {
      const title = v.title || t("events.venues.list.untitled_venue")
      return v.capacity
        ? `${title}${t("events.form.venue_capacity_suffix", {
            capacity: v.capacity,
          })}`
        : title
    }

    if (venueId && !venues.some((v) => v.id === venueId)) {
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
    items.find((i) => i.value === (venueId || NONE_VALUE))?.label ??
    t("events.form.venue_placeholder")

  return (
    <Select
      value={venueId || NONE_VALUE}
      onValueChange={(v) => onVenueChange(v === NONE_VALUE ? "" : v)}
    >
      <SelectTrigger className="w-full">
        <span className="truncate text-left">{triggerLabel}</span>
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export const VenueSelect = memo(VenueSelectImpl)
