import { CONFIG_SECTIONS } from "@/lib/salesFlowConfigSections"

/**
 * What each group of settings currently says, in one sentence.
 *
 * The editor showed ten groups open at once, thirty-three fields deep, and an
 * organiser looking for "does this door charge anything" had to read six of
 * them to find out. Closed, each group answers that question before it is
 * opened — "Community fund, 5% of every order" rather than six switches and
 * two percentages.
 *
 * These are answers, not labels. "Contribution: enabled" is the schema
 * talking; "Community fund, 5% of every order" is what somebody decided.
 */

export type ConfigValue = string | number | boolean | null | undefined
export type ConfigValues = Record<string, ConfigValue>

export interface SectionSummary {
  /** The current answer, phrased for a person. */
  answer: string
  /** Whether anything here is switched on, so quiet groups can read quiet. */
  active: boolean
}

const num = (v: ConfigValue): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

const on = (v: ConfigValue): boolean => v === true || v === "true"

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`

/**
 * Reminder cadences all have the same three fields, and all read the same way
 * out loud: when the first one goes, how often after that, and when to stop.
 */
function cadence(
  v: ConfigValues,
  prefix: string,
  nothing: string,
): SectionSummary {
  const delay = num(v[`${prefix}_delay_days`])
  if (delay === null) return { answer: nothing, active: false }

  const repeat = num(v[`${prefix}_repeat_days`])
  const max = num(v[`${prefix}_max_count`])

  const parts = [`After ${plural(delay, "day")}`]
  if (repeat !== null) parts.push(`then every ${plural(repeat, "day")}`)
  if (max !== null) parts.push(`up to ${plural(max, "time")}`)
  return { answer: parts.join(", "), active: true }
}

const SUMMARIES: Record<string, (v: ConfigValues) => SectionSummary> = {
  "Application Settings": (v) => {
    const bits: string[] = []
    if (on(v.requires_application_fee)) {
      const amount = num(v.application_fee_amount)
      bits.push(amount === null ? "A fee to apply" : `${amount} to apply`)
    } else {
      bits.push("Free to apply")
    }
    if (on(v.allows_scholarship)) bits.push("scholarships on")
    if (on(v.allows_incentive)) bits.push("incentives on")
    if (v.application_layout === "multi_step") bits.push("form in steps")
    return {
      answer: bits.join(" · "),
      active:
        on(v.requires_application_fee) ||
        on(v.allows_scholarship) ||
        on(v.allows_incentive),
    }
  },

  Discounts: (v) => ({
    answer: on(v.allows_coupons)
      ? "Coupons accepted"
      : "No coupons at this door",
    active: on(v.allows_coupons),
  }),

  "Checkout Fees": (v) => {
    const bits: string[] = []
    if (on(v.contribution_enabled)) {
      const pct = num(v.contribution_percentage)
      const label =
        typeof v.contribution_label === "string" && v.contribution_label
      bits.push(
        [
          label || "A contribution",
          pct === null ? null : `${pct}% of every order`,
        ]
          .filter(Boolean)
          .join(", "),
      )
    }
    if (on(v.insurance_enabled)) {
      const pct = num(v.insurance_percentage)
      bits.push(pct === null ? "Insurance offered" : `Insurance at ${pct}%`)
    }
    return bits.length
      ? { answer: bits.join(" · "), active: true }
      : { answer: "Nothing extra — sells at face value", active: false }
  },

  "Installment Plans": (v) => {
    if (!on(v.installments_enabled)) {
      return { answer: "One payment", active: false }
    }
    const max = num(v.installments_max)
    const every = num(v.installments_interval_count)
    const unit =
      typeof v.installments_interval === "string"
        ? v.installments_interval
        : null

    const head =
      max === null ? "Installments" : `Up to ${plural(max, "payment")}`
    const rhythm =
      unit === null
        ? null
        : every === null || every === 1
          ? `every ${unit}`
          : `every ${plural(every, unit)}`
    return { answer: [head, rhythm].filter(Boolean).join(", "), active: true }
  },

  "Open Checkout Redirects": (v) => {
    const success =
      typeof v.open_checkout_success_url === "string" &&
      v.open_checkout_success_url
    if (!success) return { answer: "Buyers stay in the portal", active: false }
    let host = success
    try {
      host = new URL(success).host
    } catch {
      // A half-typed URL is still worth showing back as typed.
    }
    const signed = Boolean(v.open_checkout_signing_secret)
    return {
      answer: `Back to ${host}${signed ? ", signed" : ", unsigned"}`,
      active: true,
    }
  },

  "Ways In": (v) => {
    const bits: string[] = []
    if (on(v.invites_enabled)) bits.push("Invitations on")
    if (on(v.referrals_enabled)) {
      const uses = num(v.max_referrals_per_attendee)
      bits.push(
        uses === null
          ? "attendees can share their link"
          : `attendees can share, ${plural(uses, "use")} each`,
      )
    }
    return bits.length
      ? { answer: bits.join(" · "), active: true }
      : { answer: "People arrive on their own", active: false }
  },

  "Check-in Pass": (v) => {
    const days = num(v.checkin_pass_lead_days)
    return days === null
      ? { answer: "No check-in pass is sent", active: false }
      : { answer: `Sent ${plural(days, "day")} before`, active: true }
  },

  "Abandoned Cart": (v) =>
    cadence(v, "abandoned_cart", "Nobody is chased about an unfinished cart"),

  "Purchase Reminder": (v) =>
    cadence(v, "purchase_reminder", "No reminder to come back and buy"),

  "Abandoned Application": (v) =>
    cadence(
      v,
      "abandoned_application",
      "Nobody is chased about a half-finished application",
    ),
}

export function summarizeSection(
  title: string,
  values: ConfigValues,
): SectionSummary {
  const summarize = SUMMARIES[title]
  // A group with no summary would silently read as empty, so say so rather
  // than pretending there is nothing configured in it.
  if (!summarize) return { answer: "Open to see", active: false }
  return summarize(values)
}

/** Every group the editor renders has a sentence. Asserted by test. */
export const SUMMARIZED_SECTIONS = Object.keys(SUMMARIES)
export const EDITOR_SECTIONS = CONFIG_SECTIONS.map((s) => s.title)
