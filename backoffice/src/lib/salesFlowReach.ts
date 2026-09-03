import type { SalesFlowPublic } from "@/client"

/**
 * Who can get in through which door.
 *
 * A list of ways in raises exactly one question that a list of names cannot
 * answer: can a stranger find this, or do they have to be sent it, or do they
 * have to already be coming? Sorting by name or by creation date answers none
 * of it, and the answer is not on any single row either — it is the
 * combination of a flow's kind and whether it is listed.
 *
 * So the screen is that answer. Three groups, in the order a buyer meets
 * them, and each door lands in exactly one.
 */

export type Reach = "public" | "by_link" | "after_paying"

export interface ReachGroup {
  id: Reach
  title: string
  description: string
  flows: SalesFlowPublic[]
}

const GROUP_COPY: Record<Reach, { title: string; description: string }> = {
  public: {
    title: "A stranger finds these",
    description: "Listed in the portal. Anyone browsing can walk in.",
  },
  by_link: {
    title: "Only if you send the link",
    description: "Not listed anywhere. They work, but nobody stumbles on them.",
  },
  after_paying: {
    title: "Only after they are in",
    description:
      "Add-ons, offered on the passes page to buyers who already paid.",
  },
}

export function reachOf(flow: SalesFlowPublic): Reach {
  // An add-on is not reached by browsing or by link in the way the other two
  // are: it appears on the passes page, and only to somebody with an approved
  // payment. Its visibility still matters — an unlisted one is kept out of
  // that catalogue entirely — but that is a fault to report on the row, not a
  // different way of getting in.
  if (flow.type === "upsale") return "after_paying"
  return flow.visibility === "direct_url_only" ? "by_link" : "public"
}

/**
 * The groups, in the order a buyer meets them. Empty ones are dropped: three
 * headings over a single door describe the schema rather than the gathering.
 */
export function groupByReach(flows: SalesFlowPublic[]): ReachGroup[] {
  const order: Reach[] = ["public", "by_link", "after_paying"]
  return order
    .map((id) => ({
      id,
      ...GROUP_COPY[id],
      flows: flows.filter((flow) => reachOf(flow) === id),
    }))
    .filter((group) => group.flows.length > 0)
}
