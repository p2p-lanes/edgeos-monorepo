export const dynamic = "force-dynamic"

import type { Metadata } from "next"
import CheckoutPreviewClient from "./CheckoutPreviewClient"

/** Keep previews out of search results — this is an internal tool, and the URL
 *  serves a popup that may not be public yet. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

/**
 * Checkout preview for the backoffice ticketing-step editor.
 *
 * Unlike the buyer-facing page there is no server render: the runtime is only
 * reachable with the preview token the backoffice posts in after mount, so
 * everything happens client-side.
 */
export default async function CheckoutPreviewPage({
  params,
}: {
  params: Promise<{ popupSlug: string }>
}) {
  const { popupSlug } = await params

  return <CheckoutPreviewClient popupSlug={popupSlug} />
}
