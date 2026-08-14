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

export const START_FRESH = "fresh"
export const START_EMPTY = "empty"

export interface StartOption {
  /** What goes in `start_from`: "fresh", "empty", or a flow id. */
  id: string
  kind: "fresh" | "copy" | "empty"
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
    "A clean reviewed way in. Nothing carried over from your other doors.",
  direct: "A clean shop. Nothing carried over from your other doors.",
  upsale: "A clean add-on. Nothing carried over from your other doors.",
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
  if (flow.is_default) bits.push("the door others started from")
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
    name: "A fresh one",
    description: FRESH_COPY[flowType],
    crossKind: false,
  }
  const empty: StartOption = {
    id: START_EMPTY,
    kind: "empty",
    name: "Nothing at all",
    description:
      "Every setting empty. The door sells nothing until you say so.",
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
    offered: [fresh, ...sameKind.map((f) => asCopy(f, false)), empty],
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
