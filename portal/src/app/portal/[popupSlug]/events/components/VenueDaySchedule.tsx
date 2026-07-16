"use client"

import { tzOffsetMinutes } from "@edgeos/shared-events"
import { Star } from "lucide-react"
import type * as React from "react"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import type { VenueAvailability } from "@/client"
import { cn } from "@/lib/utils"

/**
 * Single-venue, single-day schedule column rendered beside the portal event
 * form. Mirror of the backoffice `VenueDaySchedule`; the portal has no shared
 * UI package with the backoffice, so the day-layout math is replicated here
 * from `DayBody.tsx` / the backoffice `venueDayLayout` helper.
 *
 * Purely presentational — it does NOT fetch. `useVenueAvailability` already
 * holds the payload and passes it in. Redacted private/unlisted blocks (the
 * backend blanks their label for non-managers) render the localized
 * "Private event" text so no title leaks.
 */

const HOUR_HEIGHT = 44
const DAY_MINUTES = 24 * 60

function toLocalDayMinutes(
  iso: string,
  tz: string,
): { dayKey: string; minutes: number } | null {
  try {
    const d = new Date(iso)
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d)
    const get = (t: string) =>
      Number(parts.find((p) => p.type === t)?.value ?? "0")
    const dayKey = `${get("year")}-${String(get("month")).padStart(2, "0")}-${String(get("day")).padStart(2, "0")}`
    const minutes = get("hour") * 60 + get("minute")
    return { dayKey, minutes }
  } catch {
    return null
  }
}

type PositionedBlock = {
  key: string
  dayKey: string
  top: number
  height: number
  label: string
  source: string
  setupMinutes?: number
  teardownMinutes?: number
  highlighted?: boolean
  visibility?: string | null
}

function slotToBlocks(
  slot: {
    start: string
    end: string
    source: string
    label?: string | null
    event_start?: string | null
    event_end?: string | null
    highlighted?: boolean
    visibility?: string | null
  },
  tz: string,
  idx: number,
): PositionedBlock[] {
  const start = toLocalDayMinutes(slot.start, tz)
  const end = toLocalDayMinutes(slot.end, tz)
  if (!start || !end) return []

  let setupMinutes = 0
  let teardownMinutes = 0
  if (slot.event_start && slot.event_end) {
    const evStart = new Date(slot.event_start).getTime()
    const evEnd = new Date(slot.event_end).getTime()
    const blockStart = new Date(slot.start).getTime()
    const blockEnd = new Date(slot.end).getTime()
    setupMinutes = Math.max(0, Math.round((evStart - blockStart) / 60000))
    teardownMinutes = Math.max(0, Math.round((blockEnd - evEnd) / 60000))
  }

  const sameDay = start.dayKey === end.dayKey
  if (sameDay) {
    return [
      {
        key: `${slot.source}-${idx}`,
        dayKey: start.dayKey,
        top: (start.minutes / 60) * HOUR_HEIGHT,
        height: Math.max(
          ((end.minutes - start.minutes) / 60) * HOUR_HEIGHT,
          HOUR_HEIGHT / 4,
        ),
        label: slot.label ?? "",
        source: slot.source,
        setupMinutes,
        teardownMinutes,
        highlighted: slot.highlighted ?? false,
        visibility: slot.visibility ?? null,
      },
    ]
  }

  return [
    {
      key: `${slot.source}-${idx}-a`,
      dayKey: start.dayKey,
      top: (start.minutes / 60) * HOUR_HEIGHT,
      height: ((DAY_MINUTES - start.minutes) / 60) * HOUR_HEIGHT,
      label: slot.label ?? "",
      source: slot.source,
      highlighted: slot.highlighted ?? false,
      visibility: slot.visibility ?? null,
    },
    {
      key: `${slot.source}-${idx}-b`,
      dayKey: end.dayKey,
      top: 0,
      height: (end.minutes / 60) * HOUR_HEIGHT,
      label: slot.label ?? "",
      source: slot.source,
      highlighted: slot.highlighted ?? false,
      visibility: slot.visibility ?? null,
    },
  ]
}

function computeClosedBlocks(
  openBlocks: PositionedBlock[],
  dayKey: string,
): PositionedBlock[] {
  const dayHeight = 24 * HOUR_HEIGHT
  const sorted = [...openBlocks].sort((a, b) => a.top - b.top)
  const closed: PositionedBlock[] = []
  let cursor = 0
  let i = 0
  for (const o of sorted) {
    if (o.top > cursor) {
      closed.push({
        key: `closed-${dayKey}-${i++}`,
        dayKey,
        top: cursor,
        height: o.top - cursor,
        label: "",
        source: "closed",
      })
    }
    cursor = Math.max(cursor, o.top + o.height)
  }
  if (cursor < dayHeight) {
    closed.push({
      key: `closed-${dayKey}-${i++}`,
      dayKey,
      top: cursor,
      height: dayHeight - cursor,
      label: "",
      source: "closed",
    })
  }
  return closed
}

export function VenueDaySchedule({
  availability,
  timezone,
  dayKey,
  proposedStartIso,
  proposedEndIso,
  onPickTime,
}: {
  availability: VenueAvailability | undefined
  timezone: string
  /** Calendar day to render, as "YYYY-MM-DD". */
  dayKey: string
  proposedStartIso?: string | null
  proposedEndIso?: string | null
  onPickTime?: (isoUtc: string) => void
}) {
  const { t } = useTranslation()

  const busyBlocks = useMemo(() => {
    const busy = availability?.busy ?? []
    return busy
      .flatMap((s, i) => slotToBlocks(s, timezone, i))
      .filter((b) => b.dayKey === dayKey)
  }, [availability, timezone, dayKey])

  const openBlocks = useMemo(() => {
    const open = availability?.open_ranges ?? []
    return open
      .flatMap((s, i) =>
        slotToBlocks(
          { start: s.start, end: s.end, source: "open", label: null },
          timezone,
          i,
        ),
      )
      .filter((b) => b.dayKey === dayKey)
  }, [availability, timezone, dayKey])

  const closedBlocks = useMemo(
    () => computeClosedBlocks(openBlocks, dayKey),
    [openBlocks, dayKey],
  )

  const proposedBlock = useMemo(() => {
    if (!proposedStartIso || !proposedEndIso) return null
    return (
      slotToBlocks(
        {
          start: proposedStartIso,
          end: proposedEndIso,
          source: "proposed",
          label: null,
        },
        timezone,
        0,
      ).find((b) => b.dayKey === dayKey) ?? null
    )
  }, [proposedStartIso, proposedEndIso, timezone, dayKey])

  const handleColumnClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onPickTime) return
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const inClosed = closedBlocks.some(
      (c) => y >= c.top && y < c.top + c.height,
    )
    if (inClosed) return
    const minuteOfDay = Math.max(
      0,
      Math.min(DAY_MINUTES - 15, Math.round((y / HOUR_HEIGHT) * 60)),
    )
    const rounded = Math.round(minuteOfDay / 15) * 15
    const hh = String(Math.floor(rounded / 60)).padStart(2, "0")
    const mm = String(rounded % 60).padStart(2, "0")
    const naive = `${dayKey}T${hh}:${mm}:00`
    const guess = Date.parse(`${naive}Z`)
    const offsetMin = tzOffsetMinutes(guess, timezone)
    const utc = new Date(guess - offsetMin * 60_000)
    onPickTime(utc.toISOString())
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="max-h-[min(560px,65vh)] overflow-auto">
        <div className="grid" style={{ gridTemplateColumns: "48px 1fr" }}>
          {/* Hour labels column */}
          <div className="bg-card border-r border-border">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                style={{ height: HOUR_HEIGHT }}
                className="flex items-start justify-end pr-1.5 pt-0.5 text-[10px] font-medium text-muted-foreground border-t border-border/50 first:border-t-0"
              >
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>

          {/* Venue column */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: absolute-positioned calendar surface; a <button> would break overlay layout */}
          <div
            onClick={handleColumnClick}
            onKeyDown={(e) => {
              if (e.key === "Enter")
                handleColumnClick(
                  e as unknown as React.MouseEvent<HTMLDivElement>,
                )
            }}
            role={onPickTime ? "button" : undefined}
            tabIndex={onPickTime ? 0 : undefined}
            className={cn("relative", onPickTime && "cursor-crosshair")}
            style={{ height: HOUR_HEIGHT * 24 }}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                style={{ top: h * HOUR_HEIGHT }}
                className="absolute left-0 right-0 border-t border-border/50 first:border-t-0"
              />
            ))}

            {closedBlocks.map((c) => (
              <div
                key={c.key}
                style={{ top: c.top, height: c.height }}
                className="absolute left-0 right-0 bg-zinc-300/70 dark:bg-zinc-700/60"
              />
            ))}

            {busyBlocks.map((b) => {
              const isClosedException = b.source === "exception"
              const isPrivate =
                !isClosedException &&
                !!b.visibility &&
                b.visibility !== "public"
              const displayLabel = isClosedException
                ? b.label
                : b.label || t("events.form.private_event")
              const setupH = ((b.setupMinutes ?? 0) / 60) * HOUR_HEIGHT
              const teardownH = ((b.teardownMinutes ?? 0) / 60) * HOUR_HEIGHT
              return (
                <div
                  key={b.key}
                  style={{ top: b.top + 1, height: b.height - 2 }}
                  title={displayLabel}
                  className={cn(
                    "absolute left-1 right-1 rounded-md text-[10px] font-medium leading-tight overflow-hidden flex flex-col border",
                    isClosedException
                      ? "bg-zinc-300 text-zinc-800 border-zinc-500 border-dashed dark:bg-zinc-700 dark:text-zinc-100 dark:border-zinc-400"
                      : b.highlighted
                        ? "border-amber-400 bg-amber-100 text-amber-950 dark:bg-amber-900/50 dark:text-amber-50"
                        : "border-primary/40 bg-primary/15 text-foreground",
                  )}
                >
                  {setupH > 1 && (
                    <div
                      style={{
                        height: setupH,
                        backgroundImage:
                          "repeating-linear-gradient(135deg, rgba(0,0,0,0.12) 0 4px, transparent 4px 8px)",
                      }}
                      aria-hidden
                      className="border-b border-border/50 bg-muted/40"
                      title={t("events.form.setup_teardown")}
                    />
                  )}
                  <div className="flex items-start gap-1 px-1.5 py-1">
                    <span className="truncate flex-1">{displayLabel}</span>
                    {isPrivate && (
                      <span className="shrink-0 rounded bg-foreground/10 px-1 text-[9px] uppercase tracking-wide">
                        {t("events.form.visibility_private")}
                      </span>
                    )}
                    {b.highlighted && (
                      <Star className="h-2.5 w-2.5 shrink-0 fill-amber-500 text-amber-500" />
                    )}
                  </div>
                  {teardownH > 1 && (
                    <div
                      style={{
                        height: teardownH,
                        backgroundImage:
                          "repeating-linear-gradient(135deg, rgba(0,0,0,0.12) 0 4px, transparent 4px 8px)",
                      }}
                      aria-hidden
                      className="border-t border-border/50 bg-muted/40 mt-auto"
                      title={t("events.form.setup_teardown")}
                    />
                  )}
                </div>
              )
            })}

            {proposedBlock && (
              <div
                style={{
                  top: proposedBlock.top + 1,
                  height: proposedBlock.height - 2,
                }}
                aria-hidden
                className="absolute left-0.5 right-0.5 rounded-md border-2 border-emerald-500 bg-emerald-500/25 pointer-events-none"
              />
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border px-2 py-1.5 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm border border-primary/40 bg-primary/15" />
          {t("events.form.schedule_legend_booked")}
        </div>
        <div className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm border-2 border-emerald-500 bg-emerald-500/25" />
          {t("events.form.schedule_legend_your_slot")}
        </div>
        <div className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-zinc-300/70 border border-border dark:bg-zinc-700/60" />
          {t("events.form.schedule_legend_closed")}
        </div>
      </div>
    </div>
  )
}
