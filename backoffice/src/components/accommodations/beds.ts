/**
 * Bed composition helpers.
 *
 * Beds are stored as an explicit list (`[{type: "queen", count: 1}, ...]`)
 * rather than a free-text string, because the checkout renders them, the CSV
 * export lists them, and the property owner needs them to match their own
 * registry. A string would be unparseable in all three places.
 */

import type { BedType } from "@/client"

/** Mirrors the generated `BedSpec`: reusing the API's own union keeps the
 *  form state assignable to the request body without a cast. */
export interface BedSpec {
  type: BedType
  count: number
}

export const BED_TYPES: { value: BedType; label: string }[] = [
  { value: "king", label: "King" },
  { value: "queen", label: "Queen" },
  { value: "double", label: "Double" },
  { value: "single", label: "Single" },
  { value: "bunk", label: "Bunk" },
  { value: "sofa", label: "Sofa bed" },
]

const LABELS: Record<string, string> = Object.fromEntries(
  BED_TYPES.map((bed) => [bed.value, bed.label]),
)

function isBedType(value: unknown): value is BedType {
  return (
    typeof value === "string" && BED_TYPES.some((bed) => bed.value === value)
  )
}

export function bedLabel(type: string): string {
  return LABELS[type] ?? type
}

/** Coerce the untyped JSONB blob into bed specs, dropping anything malformed. */
export function parseBeds(raw: unknown): BedSpec[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const { type, count } = entry as { type?: unknown; count?: unknown }
    if (!isBedType(type)) return []
    const parsed = Number(count)
    if (!Number.isFinite(parsed) || parsed < 1) return []
    return [{ type, count: Math.floor(parsed) }]
  })
}

/** "1 King · 2 Single": the one-line summary used in tables and cards. */
export function describeBeds(raw: unknown): string {
  return parseBeds(raw)
    .map((bed) => `${bed.count} ${bedLabel(bed.type)}`)
    .join(" · ")
}

/** How many people the beds physically sleep, bunks counting double. */
export function sleepsFromBeds(beds: BedSpec[]): number {
  return beds.reduce((total, bed) => {
    const perBed = bed.type === "single" || bed.type === "sofa" ? 1 : 2
    return total + bed.count * perBed
  }, 0)
}
