// ──────────────────────────────────────────────────────────────────────────
// Tour content. All user-facing copy for the tour lives in this file.
//
// Kept in English to match the rest of the backoffice, which has no UI
// translation layer (`useTranslations` is for event *content*, not chrome).
//
// Wording follows the definitions already used in the onboarding checklist
// (components/Dashboard/TrialOnboarding.tsx) so the two never contradict each
// other, and the reminder semantics follow the docstring on PopupBase in
// backend/app/api/popup/schemas.py.
// ──────────────────────────────────────────────────────────────────────────

import type { TourStep } from "./types"

interface BuildTourStepsOptions {
  /** The workspace's selected gathering, or null when there isn't one yet. */
  popupId: string | null
}

/**
 * The tour in three acts: what a gathering is and how to configure it, where
 * everything else lives, and a hand-off back to the checklist.
 *
 * The gathering act is dropped when the workspace has no gathering selected —
 * there would be no form to point at.
 */
export function buildTourSteps({ popupId }: BuildTourStepsOptions): TourStep[] {
  const gatheringSteps: TourStep[] = popupId
    ? [
        {
          id: "gathering-overview",
          title: "Configuring your gathering",
          body: "This is the gathering form, reached from Gatherings in the sidebar. Its five tabs hold every setting for one edition of your event. Nothing here is permanent. You can come back and change any of it later.",
          route: { to: "/popups/$id/edit", params: { id: popupId } },
          anchor: "popup-form-tabs",
        },
        {
          id: "gathering-general",
          title: "General, the basics",
          body: "Name, tagline, location, and the start and end dates. The slug is what appears in your portal URL. Status controls whether the gathering is a draft, active, archived or ended. Only an active gathering is live for attendees.",
          anchor: "popup-tab-general",
          clickBefore: "popup-tab-general",
        },
        {
          id: "gathering-commerce",
          title: "Commerce, how it sells",
          body: 'The most consequential choice on this form is Sale type. "Application" means people apply and you approve them before they can pay; "Direct" means they buy straight away. It decides which checkout your portal renders, so settle it before you start selling. The rest of the tab covers currency, your payment integration, invoice details, application fees, insurance, contributions and installment plans.',
          anchor: "popup-tab-commerce",
          clickBefore: "popup-tab-commerce",
        },
        {
          id: "gathering-features",
          title: "Features, what to switch on",
          body: "Toggles for coupons, scholarships, self-service check-in, the attendee directory, groups, invites and referrals. Automatic emails live here too: for each reminder, the delay sets when it first goes out and doubles as the on/off switch, repeat re-sends it every so many days, and max caps the total. The two remaining tabs are Branding, for your images and links, and Languages.",
          anchor: "popup-tab-features",
          clickBefore: "popup-tab-features",
        },
      ]
    : []

  return [
    {
      id: "welcome",
      title: "Welcome to EdgeOS",
      body: "Two minutes to walk you through your workspace. A gathering is one edition of your event. It carries its dates, what you sell, and who comes. Everything in the sidebar hangs off the gathering you have selected. You can leave at any point with Skip tour.",
    },

    ...gatheringSteps,

    {
      id: "products",
      title: "Products, what you sell",
      body: "Products are what attendees purchase: access tickets, housing, add-ons. Create them here first, because the checkout funnel is arranged around them.",
      route: { to: "/products" },
      anchor: "nav-products",
    },
    {
      id: "ticketing-steps",
      title: "Ticketing Steps, the checkout funnel",
      body: "The ordered screens a buyer walks through: pick tickets, choose housing, add merch, fill in their details, review and confirm. Each step has a template that decides how it renders. A new gathering starts with a default funnel already built, so you adjust rather than start from scratch.",
      route: { to: "/ticketing-steps" },
      anchor: "nav-ticketing-steps",
    },
    {
      id: "applications",
      title: "Applications, who asked to come",
      body: "When your gathering sells by application, every submission lands here with the answers to your form. You approve or reject them, and the review queue keeps the pending ones together. The sidebar badge counts what is waiting on you.",
      route: { to: "/applications" },
      anchor: "nav-applications",
    },
    {
      id: "attendees",
      title: "Attendees, who is actually coming",
      body: "Everyone who will be there: the applicant plus any partner, kids or guests they brought. Each carries their category and the tickets they hold, with the check-in code used at the door.",
      route: { to: "/attendees" },
      anchor: "nav-attendees",
    },
    {
      id: "payments",
      title: "Payments, the money",
      body: "One row per transaction, whether a ticket purchase or an application fee. Each keeps a snapshot of what was bought, and shows any coupon, credit or group discount applied, plus insurance, contributions and installment progress. The badge counts payments still pending.",
      route: { to: "/payments" },
      anchor: "nav-payments",
    },
    {
      id: "coupons",
      title: "Coupons, discount codes",
      body: "Percentage-off codes for this gathering, each with an optional usage cap and date window. Worth knowing: they only take effect if Discount coupons is switched on in the gathering's Features tab.",
      route: { to: "/coupons" },
      anchor: "nav-coupons",
    },

    {
      id: "finish",
      title: "That's the tour",
      body: "You have seen the shape of it: configure the gathering, decide what you sell and how the funnel is arranged, then watch applications, attendees and payments come in. The Onboarding section keeps a checklist of what is still left to set up, plus a button to replay this tour whenever you want.",
    },
  ]
}

/**
 * Every anchor and click target the tour can reference. The corresponding
 * `data-tour` attributes live in AppSidebar/Main and PopupForm; a test asserts
 * this list and the step definitions stay in agreement.
 */
export const TOUR_ANCHOR_IDS = [
  "popup-form-tabs",
  "popup-tab-general",
  "popup-tab-commerce",
  "popup-tab-features",
  "nav-products",
  "nav-ticketing-steps",
  "nav-applications",
  "nav-attendees",
  "nav-payments",
  "nav-coupons",
] as const
