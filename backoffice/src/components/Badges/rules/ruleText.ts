import type {
  BadgeRuleCondition_Input,
  BadgeRuleFilters,
  RuleActivity,
  RuleMeasure,
} from "@/client"

export type Condition = BadgeRuleCondition_Input

export interface RuleNames {
  popup: (id: string) => string
  track: (id: string) => string
  venue: (id: string) => string
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`

function orList(items: string[], joiner = "or"): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} ${joiner} ${items[items.length - 1]}`
}

const hhmm = (value: string) => value.slice(0, 5)

function shortDate(value: string): string {
  const [y, m, d] = value.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export const ACTIVITY_LABELS: Record<RuleActivity, string> = {
  attend: "Checked in",
  host: "Hosted or spoke",
}

export const MEASURE_LABELS: Record<RuleMeasure, string> = {
  count: "events",
  distinct_days: "different days",
  streak_days: "days in a row",
}

function lead(condition: Condition): string {
  const n = condition.threshold
  const verb = ACTIVITY_LABELS[condition.activity ?? "attend"]
  switch (condition.measure ?? "count") {
    case "distinct_days":
      return `${verb} on ${plural(n, "different day")}`
    case "streak_days":
      return `${verb} ${plural(n, "day")} in a row`
    default:
      return `${verb} at ${plural(n, "event")}`
  }
}

/** The filters of a condition as short phrases, in reading order. */
export function filterPhrases(
  filters: BadgeRuleFilters | undefined,
  names: RuleNames,
): string[] {
  if (!filters) return []
  const parts: string[] = []
  if (filters.track_ids?.length) {
    parts.push(`in ${orList(filters.track_ids.map(names.track))}`)
  }
  if (filters.tags?.length) {
    const joiner = filters.tags_match === "all" ? "and" : "or"
    parts.push(`tagged ${orList(filters.tags, joiner)}`)
  }
  if (filters.kinds?.length) {
    parts.push(`of type ${orList(filters.kinds)}`)
  }
  if (filters.venue_ids?.length) {
    parts.push(`at ${orList(filters.venue_ids.map(names.venue))}`)
  }
  if (filters.event_ids?.length) {
    parts.push(`among ${plural(filters.event_ids.length, "chosen event")}`)
  }
  if (filters.weekdays?.length) {
    parts.push(`on ${filters.weekdays.map((d) => WEEKDAYS[d - 1]).join(", ")}`)
  }
  const after = filters.starts_after ? hhmm(filters.starts_after) : null
  const before = filters.starts_before ? hhmm(filters.starts_before) : null
  if (after && before) parts.push(`starting between ${after} and ${before}`)
  else if (after) parts.push(`starting from ${after}`)
  else if (before) parts.push(`starting before ${before}`)
  const from = filters.date_from ? shortDate(filters.date_from) : null
  const to = filters.date_to ? shortDate(filters.date_to) : null
  if (from && to) parts.push(`between ${from} and ${to}`)
  else if (from) parts.push(`from ${from}`)
  else if (to) parts.push(`until ${to}`)
  if (filters.popup_id) parts.push(`at ${names.popup(filters.popup_id)}`)
  return parts
}

export function describeCondition(
  condition: Condition,
  names: RuleNames,
): string {
  return [lead(condition), ...filterPhrases(condition.filters, names)].join(" ")
}

/** One line per condition; all of them must hold. */
export function describeRule(
  conditions: Condition[],
  names: RuleNames,
): string[] {
  return conditions.map((c) => describeCondition(c, names))
}
