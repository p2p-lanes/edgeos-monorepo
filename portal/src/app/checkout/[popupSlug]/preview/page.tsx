export const dynamic = "force-dynamic"

import type { Metadata } from "next"
import { parsePreviewOrigins } from "@/lib/checkout-preview"
import CheckoutPreviewClient from "./CheckoutPreviewClient"

/** Keep previews out of search results — this is an internal tool, and the URL
 *  serves a popup that may not be public yet. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

/**
 * Origins allowed to drive the preview, resolved per request.
 *
 * Read here, in a server component on a force-dynamic route, rather than from a
 * `NEXT_PUBLIC_` variable: those are inlined into the bundle at build time, so
 * they only work when the deployment can pass them as build args — set one on a
 * running container and nothing happens. This reads the live process
 * environment instead, so the value can change without rebuilding the image.
 *
 * `BACKOFFICE_URL` carries it because every deployment already sets it (the
 * backend needs it), and the backoffice's own URL is exactly the origin this
 * page should trust. `BACKOFFICE_ORIGIN` adds to it, comma-separated, for the
 * cases that need more than one — e.g. a local backoffice driving a deployed
 * portal.
 *
 * Both are read and unioned, rather than one falling back to the other: an
 * unset variable often arrives as the empty string, and a `??` chain would then
 * stop at it and trust nobody while `BACKOFFICE_URL` sat correctly set right
 * next to it.
 */
function allowedOrigins(): string[] {
  return parsePreviewOrigins([
    process.env.BACKOFFICE_ORIGIN,
    process.env.BACKOFFICE_URL,
  ])
}

/**
 * Checkout preview for the backoffice ticketing-step editor.
 *
 * Unlike the buyer-facing page there is no server render of the checkout: the
 * runtime is only reachable with the preview token the backoffice posts in
 * after mount, so everything else happens client-side.
 */
export default async function CheckoutPreviewPage({
  params,
}: {
  params: Promise<{ popupSlug: string }>
}) {
  const { popupSlug } = await params

  return (
    <CheckoutPreviewClient
      popupSlug={popupSlug}
      allowedOrigins={allowedOrigins()}
    />
  )
}
