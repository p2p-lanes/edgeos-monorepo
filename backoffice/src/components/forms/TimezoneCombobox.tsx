import { useMemo } from "react"

import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import {
  type TimezoneOption,
  canonicalizeTimezone,
  formatTimezoneLabel,
  getBrowserTimezone,
  getTimezoneOptions,
  syntheticTimezoneOption,
} from "@/lib/timezones"

interface TimezoneComboboxProps {
  /** IANA identifier, e.g. "America/Argentina/Buenos_Aires". */
  value: string
  onChange: (timezone: string) => void
  disabled?: boolean
}

const COMMON_GROUP = "Common"

function toComboboxOption(tz: TimezoneOption, group: string): ComboboxOption {
  return {
    value: tz.id,
    label: formatTimezoneLabel(tz.id),
    keywords: tz.searchText,
    group,
    item: (
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm">
          {tz.city}
          {tz.country ? ` · ${tz.country}` : ""}
        </span>
        <span className="flex justify-between gap-4 text-xs text-muted-foreground">
          <span className="truncate font-mono">{tz.id}</span>
          <span className="shrink-0">{tz.offset}</span>
        </span>
      </div>
    ),
  }
}

/**
 * Timezone picker over the full IANA list, searchable by city, country, id or
 * GMT offset. Same `{ value, onChange, disabled }` shape as `StartTimeSelect`,
 * so it drops straight into a `form.Field` if a form ever needs one.
 */
export function TimezoneCombobox({
  value,
  onChange,
  disabled,
}: TimezoneComboboxProps) {
  const canonical = canonicalizeTimezone(value)

  const options = useMemo(() => {
    const all = getTimezoneOptions()
    const byId = new Map(all.map((tz) => [tz.id, tz]))

    // UTC, the operator's own zone and whatever is saved — the picks worth not
    // scrolling for. They are lifted out of their region group rather than
    // duplicated, so every zone still has exactly one row.
    const commonIds = new Set(
      ["UTC", getBrowserTimezone(), canonical].filter(
        (id): id is string => !!id,
      ),
    )

    const common: ComboboxOption[] = []
    for (const id of commonIds) {
      // A saved value this browser's tzdata does not list still gets a row, so
      // opening the picker cannot silently drop it.
      const tz = byId.get(id) ?? syntheticTimezoneOption(id)
      common.push(toComboboxOption(tz, COMMON_GROUP))
    }

    const rest = all
      .filter((tz) => !commonIds.has(tz.id))
      .map((tz) => toComboboxOption(tz, tz.region))

    return [...common, ...rest]
  }, [canonical])

  return (
    <Combobox
      options={options}
      value={canonical}
      onChange={onChange}
      disabled={disabled}
      placeholder="Select a timezone"
      searchPlaceholder="Search city, country or GMT offset…"
      emptyMessage="No timezone matches that search."
      aria-label="Default timezone"
    />
  )
}
