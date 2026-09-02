import { createFileRoute, redirect } from "@tanstack/react-router"

/**
 * Referrals stopped being a separate thing.
 *
 * The data consolidated first — a referral is an invite that carries a
 * referrer instead of a creator — and then the switch that allows them moved
 * onto the sales flow. Two screens over one table taught a model that no
 * longer exists, and sent anyone looking for the setting to the wrong place.
 *
 * The route stays only to carry a bookmarked URL across.
 */
export const Route = createFileRoute("/_layout/referrals/")({
  beforeLoad: () => {
    throw redirect({ to: "/invites" })
  },
})
