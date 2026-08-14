import type { PopupAdmin, SalesFlowCreate } from "@/client"
import type { ConfigFieldKind } from "@/components/forms/ConfigFieldRow"

/**
 * What a sales flow lets an organiser decide, as data.
 *
 * Lifted out of the editor because it stopped being the editor's business:
 * the same table drives the form, the closed one-line summaries, and the diff
 * against the flow this one was copied from. Three screens reading one
 * description beats three screens agreeing by hand.
 */
export interface ConfigFieldConfig {
  key: keyof SalesFlowCreate & keyof PopupAdmin
  label: string
  description?: string
  kind: ConfigFieldKind
  options?: { value: string; label: string }[]
}

export const CONFIG_SECTIONS: {
  title: string
  description?: string
  fields: ConfigFieldConfig[]
}[] = [
  {
    title: "Application Settings",
    fields: [
      {
        key: "application_layout",
        label: "Application Layout",
        description:
          "Whether applicants answer the whole form on one page or step through it.",
        kind: "select",
        options: [
          { value: "single_page", label: "Single Page" },
          { value: "multi_step", label: "Multi Step" },
        ],
      },
      {
        key: "requires_application_fee",
        label: "Requires Application Fee",
        description: "Charge applicants before their application is reviewed.",
        kind: "boolean",
      },
      {
        key: "application_fee_amount",
        label: "Application Fee Amount",
        description: "What that fee costs.",
        kind: "currency",
      },
      {
        key: "allows_scholarship",
        label: "Allows Scholarship",
        description:
          "Let applicants ask for a reduced price as part of applying.",
        kind: "boolean",
      },
      {
        key: "allows_incentive",
        label: "Allows Incentive",
        description: "Let applicants be offered a discount on acceptance.",
        kind: "boolean",
      },
    ],
  },
  {
    // Coupons are redeemed at checkout, so they apply to any flow that
    // sells. Sitting under "Application Settings" made the heading survive
    // on flows that have no applications at all.
    title: "Discounts",
    fields: [
      {
        key: "allows_coupons",
        label: "Allows Coupons",
        description:
          "Let buyers redeem a discount code at this flow's checkout.",
        kind: "boolean",
      },
    ],
  },
  {
    title: "Checkout Fees",
    description:
      "Extra charged on top of the order at this flow's checkout. Leave both off to sell at face value.",
    fields: [
      {
        key: "insurance_enabled",
        label: "Offer Insurance",
        description:
          "Let buyers add insurance to eligible products during checkout. Opt-in: nobody is charged unless they tick it.",
        kind: "boolean",
      },
      {
        key: "insurance_percentage",
        label: "Insurance Rate (%)",
        description:
          "Percentage of the eligible products' price charged as the insurance fee.",
        kind: "number",
      },
      {
        key: "contribution_enabled",
        label: "Add Contribution",
        description:
          "Add a contribution to every order through this flow. Not opt-in: buyers pay it, so say what it funds below.",
        kind: "boolean",
      },
      {
        key: "contribution_percentage",
        label: "Contribution Rate (%)",
        description:
          "Percentage of the order total, taken before insurance so the two never compound.",
        kind: "number",
      },
      {
        key: "contribution_label",
        label: "Contribution Label",
        description: "The line item's name in the checkout summary.",
        kind: "text",
      },
      {
        key: "contribution_description",
        label: "Contribution Description",
        description:
          "Shown under that line, where the buyer decides whether the charge is fair.",
        kind: "text",
      },
    ],
  },
  {
    title: "Installment Plans",
    description:
      "Let buyers of this flow split an order into scheduled payments. SimpleFi renders the per-cycle selector at checkout.",
    fields: [
      {
        key: "installments_enabled",
        label: "Offer Installments",
        description:
          "Off means one payment. Turning it on needs both a ceiling and a deadline below.",
        kind: "boolean",
      },
      {
        key: "installments_max",
        label: "Max Installments",
        description:
          "The most a buyer may choose. SimpleFi accepts 2 to 12; the buyer picks the actual number at checkout.",
        kind: "number",
      },
      {
        key: "installments_deadline",
        label: "Deadline",
        description:
          "Every installment has to be paid by this date. It caps the ceiling above: a plan that would run past it is shortened, and plans started after it fall back to one payment.",
        kind: "date",
      },
      {
        key: "installments_interval",
        label: "Billing Interval",
        description: "How far apart the payments fall.",
        kind: "select",
        options: [
          { value: "day", label: "Day" },
          { value: "week", label: "Week" },
          { value: "month", label: "Month" },
          { value: "year", label: "Year" },
        ],
      },
      {
        key: "installments_interval_count",
        label: "Interval Count",
        description:
          "Multiplier on the interval — week x 2 bills fortnightly. Empty bills every interval.",
        kind: "number",
      },
    ],
  },
  {
    title: "Open Checkout Redirects",
    description:
      "Where a buyer lands after paying through this flow. Leave empty to keep them on the portal thank-you page.",
    fields: [
      {
        key: "open_checkout_success_url",
        label: "Success URL",
        description:
          "Your own page, shown after a successful payment. Write {locale} anywhere in it to have the buyer's language substituted in.",
        kind: "text",
      },
      {
        key: "open_checkout_cancel_url",
        label: "Cancel URL",
        description:
          "Where a buyer goes after cancelling. Defaults to the portal checkout page.",
        kind: "text",
      },
      {
        key: "open_checkout_signing_secret",
        label: "Signing Secret",
        description:
          "Shared secret used to sign the order data sent to the success URL. Set the same value on that page so it can verify the order is really yours. Empty means the redirect carries no signed payload.",
        kind: "secret",
      },
    ],
  },
  // Nine numbers under one "Reminder Cadence" heading said nothing about
  // which email each one paced. Split into the three emails the popup form
  // already names, each carrying the sentence that explains who receives it.
  {
    title: "Ways In",
    fields: [
      {
        key: "invites_enabled",
        label: "Accept Invites",
        description:
          "Let admins create invite links that land people in this flow. An invite already names the flow it opens, so this is that flow's answer.",
        kind: "boolean",
      },
      {
        key: "referrals_enabled",
        label: "Let Attendees Share",
        description:
          "Let people who came in this way create a link of their own. They share the door they entered by, so it is this flow they bring others into.",
        kind: "boolean",
      },
      {
        key: "max_referrals_per_attendee",
        label: "Uses Per Shared Link",
        description:
          "How many people one attendee's link may bring in. Empty means no limit.",
        kind: "number",
      },
    ],
  },
  {
    title: "Check-in Pass",
    description:
      "Emails ticket holders their check-in QR before the event starts. The wording is this flow's; so is the timing.",
    fields: [
      {
        key: "checkin_pass_lead_days",
        label: "Days before the event",
        description:
          "How far ahead of the start date to send. Empty sends nothing.",
        kind: "number",
      },
    ],
  },
  {
    title: "Abandoned Cart",
    description:
      "Emails buyers who did not complete their purchase. Leave the delay empty to send nothing.",
    fields: [
      {
        key: "abandoned_cart_delay_days",
        label: "Delay (days)",
        description: "How long after they left before the first email.",
        kind: "number",
      },
      {
        key: "abandoned_cart_repeat_days",
        label: "Every (days)",
        description: "How often to follow up. Empty sends once.",
        kind: "number",
      },
      {
        key: "abandoned_cart_max_count",
        label: "Max sends",
        description: "Stop after this many emails.",
        kind: "number",
      },
    ],
  },
  {
    title: "Purchase Reminder",
    description:
      "Emails accepted applicants who have not bought a pass yet. Leave the delay empty to send nothing.",
    fields: [
      {
        key: "purchase_reminder_delay_days",
        label: "Delay (days)",
        description: "How long after acceptance before the first email.",
        kind: "number",
      },
      {
        key: "purchase_reminder_repeat_days",
        label: "Every (days)",
        description: "How often to follow up. Empty sends once.",
        kind: "number",
      },
      {
        key: "purchase_reminder_max_count",
        label: "Max sends",
        description: "Stop after this many emails.",
        kind: "number",
      },
    ],
  },
  {
    title: "Abandoned Application",
    description:
      "Emails applicants whose application is still a draft, counted from their last edit. Leave the delay empty to send nothing.",
    fields: [
      {
        key: "abandoned_application_delay_days",
        label: "Delay (days)",
        description: "How long after their last edit before the first email.",
        kind: "number",
      },
      {
        key: "abandoned_application_repeat_days",
        label: "Every (days)",
        description: "How often to follow up. Empty sends once.",
        kind: "number",
      },
      {
        key: "abandoned_application_max_count",
        label: "Max sends",
        description: "Stop after this many emails.",
        kind: "number",
      },
    ],
  },
]

export const CONFIG_FIELDS = CONFIG_SECTIONS.flatMap(
  (section) => section.fields,
)
