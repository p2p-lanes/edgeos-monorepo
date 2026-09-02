import { describe, expect, it } from "vitest"
import {
  EDITOR_SECTIONS,
  SUMMARIZED_SECTIONS,
  summarizeSection,
} from "./salesFlowSectionSummary"

const say = (title: string, values: Record<string, unknown>) =>
  summarizeSection(title, values as never).answer

describe("every group the editor renders has a sentence", () => {
  it("covers all of them", () => {
    // A group with no summary reads as "Open to see", which is the editor
    // going quiet about settings that might be charging somebody money.
    // Renaming a section should break the build, not the screen.
    expect([...SUMMARIZED_SECTIONS].sort()).toEqual([...EDITOR_SECTIONS].sort())
  })
})

describe("Checkout Fees", () => {
  it("says nothing is charged when nothing is", () => {
    expect(say("Checkout Fees", {})).toBe("Nothing extra — sells at face value")
  })

  it("uses the organiser's own name for the contribution", () => {
    expect(
      say("Checkout Fees", {
        contribution_enabled: true,
        contribution_percentage: 5,
        contribution_label: "Community fund",
      }),
    ).toBe("Community fund, 5% of every order")
  })

  it("still says something when the contribution has no name yet", () => {
    expect(
      say("Checkout Fees", {
        contribution_enabled: true,
        contribution_percentage: 5,
      }),
    ).toBe("A contribution, 5% of every order")
  })

  it("names both charges when both are on", () => {
    const answer = say("Checkout Fees", {
      contribution_enabled: true,
      contribution_label: "Community fund",
      contribution_percentage: 5,
      insurance_enabled: true,
      insurance_percentage: 3,
    })
    expect(answer).toContain("Community fund")
    expect(answer).toContain("Insurance at 3%")
  })

  it("is quiet when nothing is charged and loud when something is", () => {
    expect(summarizeSection("Checkout Fees", {}).active).toBe(false)
    expect(
      summarizeSection("Checkout Fees", { insurance_enabled: true }).active,
    ).toBe(true)
  })
})

describe("Installment Plans", () => {
  it("says one payment rather than 'installments disabled'", () => {
    expect(say("Installment Plans", {})).toBe("One payment")
  })

  it("reads a plan the way somebody would say it", () => {
    expect(
      say("Installment Plans", {
        installments_enabled: true,
        installments_max: 6,
        installments_interval: "month",
        installments_interval_count: 1,
      }),
    ).toBe("Up to 6 payments, every month")
  })

  it("counts the interval when it is not one", () => {
    expect(
      say("Installment Plans", {
        installments_enabled: true,
        installments_max: 4,
        installments_interval: "week",
        installments_interval_count: 2,
      }),
    ).toBe("Up to 4 payments, every 2 weeks")
  })
})

describe("Open Checkout Redirects", () => {
  it("says where buyers end up, not the whole URL", () => {
    expect(
      say("Open Checkout Redirects", {
        open_checkout_success_url:
          "https://sponsors.example.com/{locale}/thanks",
        open_checkout_signing_secret: "set",
      }),
    ).toBe("Back to sponsors.example.com, signed")
  })

  it("says when the handover is unsigned, because that is worth noticing", () => {
    expect(
      say("Open Checkout Redirects", {
        open_checkout_success_url: "https://sponsors.example.com/thanks",
      }),
    ).toBe("Back to sponsors.example.com, unsigned")
  })

  it("never puts the secret in the sentence", () => {
    const answer = say("Open Checkout Redirects", {
      open_checkout_success_url: "https://sponsors.example.com/thanks",
      open_checkout_signing_secret: "the-key-that-signs-orders",
    })
    expect(answer).not.toContain("the-key-that-signs-orders")
  })

  it("shows a half-typed URL back as typed rather than hiding it", () => {
    expect(
      say("Open Checkout Redirects", {
        open_checkout_success_url: "sponsors.exa",
      }),
    ).toBe("Back to sponsors.exa, unsigned")
  })

  it("says buyers stay put when there is nowhere to send them", () => {
    expect(say("Open Checkout Redirects", {})).toBe("Buyers stay in the portal")
  })
})

describe("reminder cadences", () => {
  it("says nobody is chased when no delay is set", () => {
    expect(say("Abandoned Cart", {})).toBe(
      "Nobody is chased about an unfinished cart",
    )
    expect(say("Abandoned Application", {})).toBe(
      "Nobody is chased about a half-finished application",
    )
    expect(say("Purchase Reminder", {})).toBe(
      "No reminder to come back and buy",
    )
  })

  it("reads the whole rhythm when there is one", () => {
    expect(
      say("Abandoned Application", {
        abandoned_application_delay_days: 3,
        abandoned_application_repeat_days: 7,
        abandoned_application_max_count: 2,
      }),
    ).toBe("After 3 days, then every 7 days, up to 2 times")
  })

  it("says only what is set", () => {
    expect(say("Abandoned Cart", { abandoned_cart_delay_days: 1 })).toBe(
      "After 1 day",
    )
  })
})

describe("the smaller groups", () => {
  it("answers the coupon question either way", () => {
    expect(say("Discounts", { allows_coupons: true })).toBe("Coupons accepted")
    expect(say("Discounts", {})).toBe("No coupons at this door")
  })

  it("describes how people are invited in", () => {
    expect(say("Ways In", {})).toBe("People arrive on their own")
    expect(
      say("Ways In", {
        invites_enabled: true,
        referrals_enabled: true,
        max_referrals_per_attendee: 10,
      }),
    ).toBe("Invitations on · attendees can share, 10 uses each")
  })

  it("says when no check-in pass goes out at all", () => {
    expect(say("Check-in Pass", {})).toBe("No check-in pass is sent")
    expect(say("Check-in Pass", { checkin_pass_lead_days: 2 })).toBe(
      "Sent 2 days before",
    )
  })

  it("leads with what applying costs", () => {
    expect(say("Application Settings", {})).toBe("Free to apply")
    expect(
      say("Application Settings", {
        requires_application_fee: true,
        application_fee_amount: 25,
        allows_scholarship: true,
      }),
    ).toBe("25 to apply · scholarships on")
  })
})

describe("values arriving as strings", () => {
  it("reads them the same, because the form holds drafts as text", () => {
    expect(
      say("Installment Plans", {
        installments_enabled: "true",
        installments_max: "6",
        installments_interval: "month",
        installments_interval_count: "1",
      }),
    ).toBe("Up to 6 payments, every month")
  })

  it("treats an empty draft as unset rather than as zero", () => {
    expect(say("Check-in Pass", { checkin_pass_lead_days: "" })).toBe(
      "No check-in pass is sent",
    )
  })
})

describe("a secret the form never loads", () => {
  it("still counts as signed", () => {
    // The form deliberately keeps secrets out of the DOM, so its draft is
    // empty while one is stored. The caller substitutes a marker; the summary
    // must not read that absence as "no secret".
    expect(
      say("Open Checkout Redirects", {
        open_checkout_success_url: "https://sponsors.example.com/thanks",
        open_checkout_signing_secret: "stored",
      }),
    ).toBe("Back to sponsors.example.com, signed")
  })
})
