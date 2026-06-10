import { tzOffsetMinutes } from "@edgeos/shared-events"
import { Star } from "lucide-react"
import type * as React from "react"
import { useMemo } from "react"

import type { VenueAvailability } from "@/client"
import {
  computeClosedBlocks,
  DAY_MINUTES,
  HOUR_HEIGHT,
  slotToBlocks,
} from "@/components/events/venueDayLayout"
import { cn } from "@/lib/utils"

/**
 * Single-venue, single-day schedule column rendered beside the event form.
 *
 * Purely presentational — it does NOT fetch. The form already holds the
 * `availability` payload (open ranges + busy slots) and passes it in. Visual
 * style mirrors `VenueDayCalendar` (hour labels + one positioned column,
 * closed bands, setup/teardown bands, busy blocks) so the two day views read
 * the same. The proposed event slot is drawn as a distinct overlay band, and
 * clicking a free area calls `onPickTime` with the UTC instant.
 */

const PRIVATE_EVENT_FALLBACK = "Private event"

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

  // Proposed [start, end) overlay, clamped to the rendered day.
  const proposedBlock = useMemo(() => {
    if (!proposedStartIso || !proposedEndIso) return null
    const start = slotToBlocks(
      {
        start: proposedStartIso,
        end: proposedEndIso,
        source: "proposed",
        label: null,
      },
      timezone,
      0,
    ).find((b) => b.dayKey === dayKey)
    return start ?? null
  }, [proposedStartIso, proposedEndIso, timezone, dayKey])

  const handleColumnClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onPickTime) return
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    // Don't invite scheduling inside a closed band.
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
    <div className="rounded-lg border-2 border-border bg-card overflow-hidden">
      <div className="max-h-[min(560px,65vh)] overflow-auto">
        <div className="grid" style={{ gridTemplateColumns: "48px 1fr" }}>
          {/* Hour labels column */}
          <div className="bg-card border-r border-border">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                style={{ height: HOUR_HEIGHT }}
                className="flex items-start justify-end pr-1.5 pt-0.5 text-[10px] font-medium text-muted-foreground border-t border-border first:border-t-0"
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
                className="absolute left-0 right-0 border-t border-border"
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
                : b.label || PRIVATE_EVENT_FALLBACK
              const setupH = ((b.setupMinutes ?? 0) / 60) * HOUR_HEIGHT
              const teardownH = ((b.teardownMinutes ?? 0) / 60) * HOUR_HEIGHT
              return (
                <div
                  key={b.key}
                  style={{ top: b.top + 1, height: b.height - 2 }}
                  title={displayLabel}
                  className={cn(
                    "absolute left-1 right-1 rounded-md text-[10px] font-medium leading-tight overflow-hidden shadow-sm flex flex-col",
                    isClosedException
                      ? "bg-zinc-300 text-zinc-800 border border-zinc-500 border-dashed dark:bg-zinc-700 dark:text-zinc-100 dark:border-zinc-400"
                      : b.highlighted
                        ? "bg-amber-500 text-white border border-amber-600 dark:bg-amber-500 dark:text-white dark:border-amber-400"
                        : "bg-sky-600 text-white border border-sky-700 dark:bg-sky-500 dark:text-white dark:border-sky-400",
                  )}
                >
                  {setupH > 1 && (
                    <div
                      style={{
                        height: setupH,
                        backgroundImage:
                          "repeating-linear-gradient(135deg, rgba(255,255,255,0.18) 0 4px, transparent 4px 8px)",
                      }}
                      aria-hidden
                      className={cn(
                        "border-b",
                        b.highlighted
                          ? "bg-amber-700 border-amber-800 dark:bg-amber-700 dark:border-amber-800"
                          : "bg-sky-900 border-sky-950 dark:bg-sky-900 dark:border-sky-950",
                      )}
                      title="Setup"
                    />
                  )}
                  <div className="flex items-start gap-1 px-1.5 py-1">
                    <span className="truncate flex-1">{displayLabel}</span>
                    {isPrivate && (
                      <span className="shrink-0 rounded bg-white/20 px-1 text-[9px] uppercase tracking-wide">
                        Private
                      </span>
                    )}
                    {b.highlighted && (
                      <Star className="h-2.5 w-2.5 shrink-0 fill-white text-white" />
                    )}
                  </div>
                  {teardownH > 1 && (
                    <div
                      style={{
                        height: teardownH,
                        backgroundImage:
                          "repeating-linear-gradient(135deg, rgba(255,255,255,0.18) 0 4px, transparent 4px 8px)",
                      }}
                      aria-hidden
                      className={cn(
                        "border-t mt-auto",
                        b.highlighted
                          ? "bg-amber-700 border-amber-800 dark:bg-amber-700 dark:border-amber-800"
                          : "bg-sky-900 border-sky-950 dark:bg-sky-900 dark:border-sky-950",
                      )}
                      title="Teardown"
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
          <span className="h-2.5 w-2.5 rounded-sm bg-sky-600 dark:bg-sky-500" />
          Booked
        </div>
        <div className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm border-2 border-emerald-500 bg-emerald-500/25" />
          Your slot
        </div>
        <div className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-zinc-300/70 border border-border dark:bg-zinc-700/60" />
          Closed
        </div>
      </div>
    </div>
  )
}
