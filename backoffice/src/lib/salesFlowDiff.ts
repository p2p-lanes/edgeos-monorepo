import type { SalesFlowPublic } from "@/client"
import {
  CONFIG_SECTIONS,
  type ConfigFieldConfig,
} from "@/lib/salesFlowConfigSections"

/**
 * How one way in differs from another, for the moment a starting point is
 * being chosen.
 *
 * WHERE THIS BELONGS: the creation screen, answering "what do I get if I
 * start from this door" while somebody is deciding. Not the editor.
 *
 * It was in the editor and came out, for a reason worth keeping written down.
 * This compares two LIVE rows, so the answer is a property of a pair rather
 * than of a door — and the other half moves. Sponsors reads "13 settings
 * changed" today; edit Attendee's coupon policy tomorrow and Sponsors reads
 * 14, with nobody having opened Sponsors. A number that changes when you did
 * not touch the thing is worse than no number, and on a configuration screen
 * it is actively misleading.
 *
 * At creation the same comparison is sound, because it is momentary: it
 * describes a choice being made now, not a standing claim about a door.
 *
 * If "did I change this, or did it come this way" is ever asked for again,
 * the answer is not this function. It is to store what the flow was seeded
 * with when it was born and compare against that — stable, belonging to one
 * door, and unmoved by edits elsewhere.
 *
 * SCOPE: compares what the flow row holds, its identity and its configuration.
 * It does NOT compare steps or the products on sale, which live in
 * `ticketing_steps` behind another request. Real doors are what surfaced
 * that — a volunteers door whose whole point is "one pass, no merch" came
 * back as an exact copy, because none of that is configuration.
 */

export interface FlowDifference {
  section: string
  label: string
  /** This flow's value, already phrased for a person. */
  value: string
  /** The same setting on the flow this one was copied from. */
  baselineValue: string
}

export interface FlowDiff {
  /** Null when this flow IS the baseline, or when there is nothing to compare. */
  baselineName: string | null
  differences: FlowDifference[]
}

type ConfigValue = string | number | boolean | null | undefined

const NOT_SET = "not set"

function readValue(flow: SalesFlowPublic, key: string): ConfigValue {
  return (flow as unknown as Record<string, ConfigValue>)[key]
}

function isBlank(raw: ConfigValue): boolean {
  return raw === null || raw === undefined || raw === ""
}

/**
 * A comparable form of the value, so that only real differences surface.
 *
 * Numbers arrive as strings on some fields and as numbers on others (a
 * backend Decimal serializes to "5.00", a plain int to 5), and "5.00" is not
 * a different decision from 5. Comparing the raw values would report a
 * difference nobody made.
 */
function normalize(field: ConfigFieldConfig, raw: ConfigValue): string | null {
  if (field.kind === "boolean") return String(Boolean(raw))
  if (isBlank(raw)) return null
  if (field.kind === "number" || field.kind === "currency") {
    const parsed = Number(raw)
    return Number.isNaN(parsed) ? String(raw) : String(parsed)
  }
  if (field.kind === "secret") return "set"
  if (field.kind === "date") return String(raw).slice(0, 10)
  return String(raw)
}

/** The value as an organiser would say it out loud. */
export function describeValue(
  field: ConfigFieldConfig,
  raw: ConfigValue,
): string {
  if (field.kind === "boolean") return raw ? "on" : "off"
  if (isBlank(raw)) return NOT_SET
  if (field.kind === "secret") return "set"
  if (field.kind === "select") {
    const option = field.options?.find((o) => o.value === String(raw))
    return option?.label ?? String(raw)
  }
  if (field.kind === "date") return String(raw).slice(0, 10)
  if (field.kind === "number" || field.kind === "currency") {
    const parsed = Number(raw)
    return Number.isNaN(parsed) ? String(raw) : String(parsed)
  }
  return String(raw)
}

/**
 * Whether this setting can do anything on this flow.
 *
 * A direct sale never produces an application, so a scholarship toggle there
 * is not a difference worth reporting — it is a setting that can never run.
 */
function appliesToFlow(
  field: ConfigFieldConfig,
  flow: SalesFlowPublic,
): boolean {
  return field.appliesTo === undefined || field.appliesTo === flow.type
}

const TYPE_COPY: Record<string, string> = {
  application: "people apply first",
  direct: "people buy directly",
  upsale: "an add-on for people already in",
}

const VISIBILITY_COPY: Record<string, string> = {
  portal_listed: "listed in the portal",
  direct_url_only: "only by link",
}

/**
 * What the door IS, as opposed to how its checkout behaves.
 *
 * These sit outside CONFIG_SECTIONS because the editor renders them as
 * identity rather than settings, but they are the first thing that
 * distinguishes two doors and leaving them out made an upsale gated on
 * already holding a ticket read as an exact copy of the general entry.
 */
function identityDifferences(
  flow: SalesFlowPublic,
  baseline: SalesFlowPublic,
): FlowDifference[] {
  const rows: FlowDifference[] = []
  const add = (label: string, value: string, baselineValue: string) => {
    if (value !== baselineValue) {
      rows.push({ section: "This door", label, value, baselineValue })
    }
  }

  const phrase = (copy: Record<string, string>, raw: string | undefined) =>
    raw ? (copy[raw] ?? raw) : NOT_SET

  add(
    "What it does",
    phrase(TYPE_COPY, flow.type),
    phrase(TYPE_COPY, baseline.type),
  )
  add(
    "Where it appears",
    phrase(VISIBILITY_COPY, flow.visibility),
    phrase(VISIBILITY_COPY, baseline.visibility),
  )
  // Not the rule itself: describing a nested predicate tree in one line is
  // its own problem, and whether a door turns people away is the part that
  // belongs in a summary.
  add(
    "Who can use it",
    flow.restriction_rule ? "restricted" : "anyone",
    baseline.restriction_rule ? "restricted" : "anyone",
  )
  return rows
}

export function diffAgainstBaseline(
  flow: SalesFlowPublic,
  baseline: SalesFlowPublic | null | undefined,
): FlowDiff {
  if (!baseline || baseline.id === flow.id) {
    return { baselineName: null, differences: [] }
  }

  const differences: FlowDifference[] = identityDifferences(flow, baseline)
  for (const section of CONFIG_SECTIONS) {
    for (const field of section.fields) {
      if (!appliesToFlow(field, flow)) continue

      const mine = readValue(flow, field.key)
      const theirs = readValue(baseline, field.key)
      if (normalize(field, mine) === normalize(field, theirs)) continue

      differences.push({
        section: section.title,
        label: field.label,
        value: describeValue(field, mine),
        baselineValue: describeValue(field, theirs),
      })
    }
  }

  return { baselineName: baseline.name, differences }
}

/**
 * One sentence for the top of the editor.
 *
 * Deliberately not a count of fields. "3 fields differ" is a fact about the
 * schema; "Configured like Attendee, apart from 3 settings" is a fact about
 * the door.
 *
 * "Configured" is doing real work in that sentence: what this compares is the
 * flow row, so a door that differs only in what it puts on sale is configured
 * identically and the sentence stays true.
 */
export function summarizeDiff(diff: FlowDiff): string | null {
  if (diff.baselineName === null) return null
  if (diff.differences.length === 0) {
    return `Configured exactly like ${diff.baselineName}.`
  }
  const n = diff.differences.length
  return `Configured like ${diff.baselineName}, apart from ${n} ${
    n === 1 ? "setting" : "settings"
  }.`
}
