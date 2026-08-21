import type { SalesFlowPublic, SalesFlowType } from "@/client"

/**
 * What a new way in can start from, and which of those make sense for the
 * kind of door somebody just said they were opening. Copying is opt-in, and
 * a source that cannot produce this kind of flow is never offered.
 */

// The one starting point that is not an existing flow. There used to be two,
// on the theory that a kind of flow could carry preset values; it cannot carry
// many worth having, so they were the same thing twice.
export const START_FRESH = "fresh"

export interface StartOption {
  /** What goes in `start_from`: "fresh" or a flow id. */
  id: string
  kind: "fresh" | "copy"
  name: string
  description: string
}

export const TYPE_COPY: Record<
  SalesFlowType,
  { label: string; description: string }
> = {
  application: {
    label: "People apply first",
    description: "They apply, you review, then they buy.",
  },
  direct: {
    label: "People buy directly",
    description: "No review. Anyone who reaches it pays.",
  },
  upsale: {
    label: "An add-on",
    description: "Only for people already coming.",
  },
}

// It is not "nothing": the flow still gets its kind's checkout steps, and
// that is the one thing worth saying about starting clean.
const FRESH_DESCRIPTION = "No settings copied. Checkout steps included."

/** Facts, and silence when there are none. The fallback prose read as filler
 * because that is what it was. */
function describeFlow(flow: SalesFlowPublic): string {
  const bits: string[] = []
  if (flow.requires_application_fee) bits.push("fee to apply")
  if (flow.contribution_enabled) bits.push("contribution")
  if (flow.installments_enabled) bits.push("installments")
  if (flow.allows_coupons === false) bits.push("no coupons")
  return bits.join(" · ")
}

export interface StartChoices {
  /** Fresh first, then only sources that can produce this kind of flow. */
  offered: StartOption[]
}

export function startChoicesFor(
  flowType: SalesFlowType,
  flows: SalesFlowPublic[],
): StartChoices {
  const fresh: StartOption = {
    id: START_FRESH,
    kind: "fresh",
    name: "Start from scratch",
    description: FRESH_DESCRIPTION,
  }
  const asCopy = (flow: SalesFlowPublic): StartOption => ({
    id: flow.id,
    kind: "copy",
    name: `A copy of ${flow.name}`,
    description: describeFlow(flow),
  })

  const sameKind = flows.filter((f) => f.type === flowType)

  return {
    offered: [fresh, ...sameKind.map(asCopy)],
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
 * Fresh is always the default. Copying remains available from the explicit
 * change interaction after the operator chooses the flow type.
 */
export function autoStart(choices: StartChoices): StartOption | null {
  return choices.offered.find((option) => option.kind === "fresh") ?? null
}
