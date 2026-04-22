import { Clock, Plus, X } from "lucide-react"

import type { VenueWeeklyHourInput, VenueWeeklyHourRef } from "@/client"
import { Button } from "@/components/ui/button"
import { InlineSection } from "@/components/ui/inline-form"
import { Switch } from "@/components/ui/switch"
import { TimePicker } from "@/components/ui/time-picker"

const DAYS_OF_WEEK: { value: number; label: string; short: string }[] = [
  { value: 0, label: "Monday", short: "Mon" },
  { value: 1, label: "Tuesday", short: "Tue" },
  { value: 2, label: "Wednesday", short: "Wed" },
  { value: 3, label: "Thursday", short: "Thu" },
  { value: 4, label: "Friday", short: "Fri" },
  { value: 5, label: "Saturday", short: "Sat" },
  { value: 6, label: "Sunday", short: "Sun" },
]

/**
 * Hydrate the editor state from the server's weekly-hours snapshot. Each
 * server row maps to one editable slot. Days that appear with
 * ``is_closed=true`` collapse into a single "Closed" marker so the editor
 * can render the toggle without manufacturing hour values.
 */
export function buildInitialWeeklyHours(
  initial: VenueWeeklyHourRef[] | undefined,
): VenueWeeklyHourInput[] {
  if (!initial || initial.length === 0) {
    // Default: all days closed, single marker row per day.
    return DAYS_OF_WEEK.map((d) => ({
      day_of_week: d.value,
      open_time: null,
      close_time: null,
      is_closed: true,
    }))
  }
  return initial.map((h) => ({
    day_of_week: h.day_of_week,
    open_time: h.open_time ?? null,
    close_time: h.close_time ?? null,
    is_closed: h.is_closed,
  }))
}

interface WeeklyHoursEditorProps {
  value: VenueWeeklyHourInput[]
  onChange: (hours: VenueWeeklyHourInput[]) => void
  disabled?: boolean
}

function isOpenSlot(h: VenueWeeklyHourInput): boolean {
  return !h.is_closed && h.open_time != null && h.close_time != null
}

export function WeeklyHoursEditor({
  value,
  onChange,
  disabled,
}: WeeklyHoursEditorProps) {
  const slotsByDay = new Map<number, VenueWeeklyHourInput[]>()
  for (const h of value) {
    const list = slotsByDay.get(h.day_of_week) ?? []
    list.push(h)
    slotsByDay.set(h.day_of_week, list)
  }

  const dayIsOpen = (day: number) =>
    (slotsByDay.get(day) ?? []).some(isOpenSlot)

  /** Replace the slots for ``day`` in ``value`` with ``nextSlots``. */
  const setDaySlots = (day: number, nextSlots: VenueWeeklyHourInput[]) => {
    const rest = value.filter((h) => h.day_of_week !== day)
    onChange([...rest, ...nextSlots])
  }

  const toggleDayOpen = (day: number, open: boolean) => {
    if (open) {
      setDaySlots(day, [
        {
          day_of_week: day,
          open_time: "09:00",
          close_time: "17:00",
          is_closed: false,
        },
      ])
    } else {
      setDaySlots(day, [
        {
          day_of_week: day,
          open_time: null,
          close_time: null,
          is_closed: true,
        },
      ])
    }
  }

  const addSlot = (day: number) => {
    const current = slotsByDay.get(day) ?? []
    const openSlots = current.filter(isOpenSlot)
    // Seed the new slot a few hours after the last one so users can land
    // on something sensible (e.g. 9-11 → add 13-17) instead of defaults.
    let newOpen = "18:00"
    let newClose = "21:00"
    if (openSlots.length > 0) {
      const last = openSlots[openSlots.length - 1]
      if (last.close_time) {
        const [hh, mm] = last.close_time.split(":").map(Number)
        const startH = Math.min(23, (hh ?? 0) + 2)
        newOpen = `${String(startH).padStart(2, "0")}:${String(mm ?? 0).padStart(2, "0")}`
        newClose = `${String(Math.min(23, startH + 3)).padStart(2, "0")}:${String(mm ?? 0).padStart(2, "0")}`
      }
    }
    setDaySlots(day, [
      ...openSlots,
      {
        day_of_week: day,
        open_time: newOpen,
        close_time: newClose,
        is_closed: false,
      },
    ])
  }

  const updateSlot = (
    day: number,
    idx: number,
    patch: Partial<VenueWeeklyHourInput>,
  ) => {
    const current = (slotsByDay.get(day) ?? []).filter(isOpenSlot)
    const next = current.map((s, i) => (i === idx ? { ...s, ...patch } : s))
    setDaySlots(day, next)
  }

  const removeSlot = (day: number, idx: number) => {
    const current = (slotsByDay.get(day) ?? []).filter(isOpenSlot)
    const next = current.filter((_, i) => i !== idx)
    if (next.length === 0) {
      // Last slot removed → mark the day closed.
      setDaySlots(day, [
        {
          day_of_week: day,
          open_time: null,
          close_time: null,
          is_closed: true,
        },
      ])
    } else {
      setDaySlots(day, next)
    }
  }

  return (
    <InlineSection title="Weekly hours">
      <fieldset
        disabled={disabled}
        className="space-y-2 py-3 disabled:opacity-70"
      >
        {DAYS_OF_WEEK.map((day) => {
          const open = dayIsOpen(day.value)
          const slots = (slotsByDay.get(day.value) ?? []).filter(isOpenSlot)
          return (
            <div
              key={day.value}
              className="rounded-md border px-3 py-2 space-y-2"
            >
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 w-24 shrink-0">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{day.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id={`open-${day.value}`}
                    checked={open}
                    onCheckedChange={(checked) =>
                      toggleDayOpen(day.value, checked)
                    }
                  />
                  <span className="text-xs text-muted-foreground">
                    {open ? "Open" : "Closed"}
                  </span>
                </div>
                {open && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 gap-1 text-xs"
                    onClick={() => addSlot(day.value)}
                  >
                    <Plus className="h-3 w-3" /> Add slot
                  </Button>
                )}
              </div>
              {open &&
                slots.map((slot, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 pl-[7.25rem]"
                  >
                    <TimePicker
                      value={slot.open_time ?? ""}
                      onChange={(v) =>
                        updateSlot(day.value, idx, { open_time: v })
                      }
                    />
                    <span className="text-sm text-muted-foreground">to</span>
                    <TimePicker
                      value={slot.close_time ?? ""}
                      onChange={(v) =>
                        updateSlot(day.value, idx, { close_time: v })
                      }
                    />
                    {slots.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label="Remove slot"
                        onClick={() => removeSlot(day.value, idx)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
            </div>
          )
        })}
      </fieldset>
    </InlineSection>
  )
}
