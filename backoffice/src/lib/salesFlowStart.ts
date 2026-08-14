import type { SalesFlowPublic, SalesFlowType } from "@/client"

/**
 * What a new way in can start from, and which of those make sense for the
 * kind of door somebody just said they were opening.
 *
 * Asking what the door does BEFORE asking where it starts is the whole point
 * of the order: a starting point that cannot produce this kind of door is
 * never offered, so choosing one that drags settings the door can never read
 * stops being a mistake anyone can make. It is not filtered after the fact —
 * it is not on the screen.
 *
 * Copying across kinds stays possible, deliberately, but behind something you
 * have to open. Refusing it outright would mean somebody wanting their
 * partner's payment terms on a reviewed door has to retype them.
 */

// The one starting point that is not an existing flow. There used to be two,
// on the theory that a kind of flow could carry preset values; it cannot carry
// many worth having, so they were the same thing twice.
export const START_FRESH = "fresh"

export interface StartOption {
  /** What goes in `start_from`: "fresh", "empty", or a flow id. */
  id: string
  kind: "fresh" | "copy"
  name: string
  description: string
  /** Only for copies: this door is of a different kind to the one being made. */
  crossKind: boolean
  /** Only for copies: what that door is. */
  sourceType?: SalesFlowType
}

export const TYPE_COPY: Record<
  SalesFlowType,
  { label: string; description: string; aside: string }
> = {
  application: {
    label: "People apply first",
    description:
      "They fill in a form, you review them, and only then do they buy.",
    aside: "Reviewers, applications, scholarships",
  },
  direct: {
    label: "People buy directly",
    description:
      "No review and no waiting. Anyone who can reach it picks products and pays.",
    aside: "Anonymous checkout, no application",
  },
  upsale: {
    label: "An add-on",
    description:
      "Sells only to people already coming. Everyone else is turned away.",
    aside: "Shown on the passes page to buyers who already paid",
  },
}

const FRESH_COPY: Record<SalesFlowType, string> = {
  application:
    "Every setting empty. Only the ones a reviewed flow can use are offered.",
  direct: "Every setting empty. Only the ones a shop can use are offered.",
  upsale: "Every setting empty. Only the ones an add-on can use are offered.",
}

/** What a door of this kind cannot use, so a cross-kind copy leaves it behind. */
export function notCarriedAcross(flowType: SalesFlowType): string[] {
  if (flowType === "application") {
    return ["The redirect after paying, and the signing secret with it"]
  }
  return [
    "The application form's layout, its fee, scholarships and incentives",
    "Reminders that chase half-finished applications",
  ]
}

function describeFlow(flow: SalesFlowPublic): string {
  const bits: string[] = []
  if (flow.is_default) bits.push("the flow others started from")
  if (flow.contribution_enabled) bits.push("adds a contribution")
  if (flow.installments_enabled) bits.push("offers installments")
  if (flow.requires_application_fee) bits.push("charges to apply")
  if (flow.allows_coupons === false) bits.push("no coupons")
  return bits.length ? bits.join(" · ") : "its settings as they stand"
}

export interface StartChoices {
  /** Offered directly: they can all produce this kind of door. */
  offered: StartOption[]
  /** Behind a disclosure: doors of another kind, with what gets dropped. */
  otherKinds: StartOption[]
}

export function startChoicesFor(
  flowType: SalesFlowType,
  flows: SalesFlowPublic[],
): StartChoices {
  const fresh: StartOption = {
    id: START_FRESH,
    kind: "fresh",
    name: "Nothing at all",
    description: FRESH_COPY[flowType],
    crossKind: false,
  }
  const asCopy = (flow: SalesFlowPublic, crossKind: boolean): StartOption => ({
    id: flow.id,
    kind: "copy",
    name: `A copy of ${flow.name}`,
    description: describeFlow(flow),
    crossKind,
    sourceType: flow.type,
  })

  const sameKind = flows.filter((f) => f.type === flowType)
  const otherKinds = flows.filter((f) => f.type !== flowType)

  return {
    offered: [fresh, ...sameKind.map((f) => asCopy(f, false))],
    otherKinds: otherKinds.map((f) => asCopy(f, true)),
  }
}

export function slugifyFlowName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * The starting point to take without asking, or null when there is a real
 * choice to make.
 *
 * Asking is only worth somebody's time when the answers differ. With nothing
 * of this kind to copy there is one possible answer; with exactly one, that
 * one is almost always right — it is the same gathering, so its terms carry
 * over, and it is what the backend did before `start_from` existed.
 *
 * The question earns its screen at the third flow, which is also when the
 * reason for `fresh` first appears: a partner's five percent contribution is
 * only worth refusing once some flow has one.
 *
 * Flows of another kind never force the question. Copying across kinds is the
 * deliberate path, reached by changing the answer rather than by being asked
 * for it.
 */
export function autoStart(choices: StartChoices): StartOption | null {
  const copies = choices.offered.filter((option) => option.kind === "copy")
  if (copies.length > 1) return null
  return copies[0] ?? choices.offered[0] ?? null
}
