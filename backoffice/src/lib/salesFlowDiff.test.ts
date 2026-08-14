import { describe, expect, it } from "vitest"
import type { SalesFlowPublic } from "@/client"
import { diffAgainstBaseline, summarizeDiff } from "./salesFlowDiff"

const flow = (over: Partial<SalesFlowPublic> = {}): SalesFlowPublic =>
  ({
    id: "flow-1",
    popup_id: "popup-1",
    tenant_id: "tenant-1",
    slug: "volunteers",
    name: "Volunteers",
    type: "application",
    visibility: "portal_listed",
    restriction_rule: null,
    is_default: false,
    insurance_enabled: false,
    contribution_enabled: false,
    allows_coupons: true,
    installments_enabled: false,
    ...over,
  }) as SalesFlowPublic

const baseline = (over: Partial<SalesFlowPublic> = {}): SalesFlowPublic =>
  flow({
    id: "flow-0",
    slug: "attendee",
    name: "Attendee",
    is_default: true,
    ...over,
  })

describe("diffAgainstBaseline", () => {
  it("says nothing when there is no baseline to compare against", () => {
    const diff = diffAgainstBaseline(flow(), null)
    expect(diff.baselineName).toBeNull()
    expect(diff.differences).toEqual([])
  })

  it("says nothing about the flow that IS the baseline", () => {
    const self = baseline()
    expect(diffAgainstBaseline(self, self).baselineName).toBeNull()
  })

  it("reports only what somebody changed", () => {
    const diff = diffAgainstBaseline(
      flow({ allows_coupons: false }),
      baseline({ allows_coupons: true }),
    )
    expect(diff.differences).toHaveLength(1)
    expect(diff.differences[0]).toMatchObject({
      label: "Allows Coupons",
      value: "off",
      baselineValue: "on",
    })
  })

  it('does not invent a difference between 5 and "5.00"', () => {
    // The reason normalization exists: a Decimal column serializes to "5.00"
    // and a form writes back 5. Nobody changed anything.
    const diff = diffAgainstBaseline(
      flow({ insurance_enabled: true, insurance_percentage: 5 } as never),
      baseline({
        insurance_enabled: true,
        insurance_percentage: "5.00",
      } as never),
    )
    expect(diff.differences).toEqual([])
  })

  it("treats null and empty string as the same absence", () => {
    const diff = diffAgainstBaseline(
      flow({ contribution_label: "" } as never),
      baseline({ contribution_label: null } as never),
    )
    expect(diff.differences).toEqual([])
  })

  it("never reports a secret's value, only whether one exists", () => {
    const diff = diffAgainstBaseline(
      flow({ open_checkout_signing_secret: "the-real-key" } as never),
      baseline({ open_checkout_signing_secret: null } as never),
    )
    expect(diff.differences).toHaveLength(1)
    expect(diff.differences[0].value).toBe("set")
    expect(JSON.stringify(diff)).not.toContain("the-real-key")
  })

  it("stays quiet about settings that cannot run on this flow", () => {
    // A direct sale produces no application, so a scholarship toggle there is
    // not a decision anybody made.
    const diff = diffAgainstBaseline(
      flow({ type: "direct", allows_scholarship: false } as never),
      baseline({ allows_scholarship: true } as never),
    )
    expect(diff.differences.map((d) => d.label)).not.toContain(
      "Allows Scholarship",
    )
  })

  it("keeps those settings on a flow that does produce applications", () => {
    const diff = diffAgainstBaseline(
      flow({ allows_scholarship: false } as never),
      baseline({ allows_scholarship: true } as never),
    )
    expect(diff.differences.map((d) => d.label)).toContain("Allows Scholarship")
  })

  it("uses the option's label rather than its stored value", () => {
    const diff = diffAgainstBaseline(
      flow({ installments_interval: "week" } as never),
      baseline({ installments_interval: "month" } as never),
    )
    expect(diff.differences[0]).toMatchObject({
      value: "Week",
      baselineValue: "Month",
    })
  })

  // The three below exist because running this against real doors showed an
  // upsale gated on already holding a ticket reading as an exact copy of the
  // general entry. What a door IS was not being compared at all.
  it("says what the door does when that is what changed", () => {
    const diff = diffAgainstBaseline(
      flow({ type: "upsale" } as never),
      baseline(),
    )
    expect(diff.differences[0]).toMatchObject({
      section: "This door",
      label: "What it does",
      value: "an add-on for people already in",
      baselineValue: "people apply first",
    })
  })

  it("says when a door is only reachable by link", () => {
    const diff = diffAgainstBaseline(
      flow({ visibility: "direct_url_only" } as never),
      baseline(),
    )
    expect(diff.differences[0].value).toBe("only by link")
  })

  it("says a door turns people away without spelling out the rule", () => {
    const diff = diffAgainstBaseline(
      flow({
        restriction_rule: { kind: "has_product", scope: "category" },
      } as never),
      baseline(),
    )
    expect(diff.differences[0]).toMatchObject({
      label: "Who can use it",
      value: "restricted",
      baselineValue: "anyone",
    })
  })

  it("carries the section so the differences can be grouped", () => {
    const diff = diffAgainstBaseline(
      flow({ contribution_enabled: true } as never),
      baseline(),
    )
    expect(diff.differences[0].section).toBe("Checkout Fees")
  })
})

describe("summarizeDiff", () => {
  it("says a copy is a copy", () => {
    const diff = diffAgainstBaseline(flow(), baseline())
    expect(summarizeDiff(diff)).toBe("Configured exactly like Attendee.")
  })

  it("counts in settings, not in fields", () => {
    const diff = diffAgainstBaseline(
      flow({ allows_coupons: false }),
      baseline({ allows_coupons: true }),
    )
    expect(summarizeDiff(diff)).toBe(
      "Configured like Attendee, apart from 1 setting.",
    )
  })

  it("pluralizes", () => {
    const diff = diffAgainstBaseline(
      flow({ allows_coupons: false, contribution_enabled: true }),
      baseline({ allows_coupons: true }),
    )
    expect(summarizeDiff(diff)).toBe(
      "Configured like Attendee, apart from 2 settings.",
    )
  })

  it("has nothing to say about the flow others are copied from", () => {
    const self = baseline()
    expect(summarizeDiff(diffAgainstBaseline(self, self))).toBeNull()
  })
})
