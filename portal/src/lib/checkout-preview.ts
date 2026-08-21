/**
 * Contract between the backoffice's ticketing-step editor and the checkout
 * preview page it embeds in an iframe.
 *
 * The preview renders the real checkout — same shell, skin, theme and variants
 * a buyer sees — so the operator never has to guess how a step will look. The
 * portal fetches the event's own data from the API exactly like production
 * does; the only thing that crosses the iframe boundary is the step being
 * edited, so unsaved changes show up without a round trip through the database.
 *
 * ## What authorizes a preview
 *
 * The preview token, and only the token. The API mints it for an authenticated
 * operator, scoped to one popup and valid for 15 minutes, and checks it on
 * every runtime request — so a page holding no token renders nothing, and a
 * page holding one shows exactly what its bearer could already fetch directly.
 *
 * This page therefore does not keep an allowlist of origins that may drive it.
 * One was tried and removed: it had to be configured on the portal, it broke
 * the whole feature whenever that configuration was missing or blank, and it
 * bought nothing — the API accepts the token from any caller, so an allowlist
 * here could never protect a leaked one. What does still matter is the
 * direction that carries the secret: the backoffice posts the token to the
 * iframe's exact origin, never to `*` (see `useStepPreviewBridge`).
 */

import type { CheckoutRuntimeResponse, TicketingStepPublic } from "@/client"

/** Discriminator on every message, so unrelated postMessage traffic (browser
 *  extensions, dev tooling) is ignored on both ends. */
export const PREVIEW_MESSAGE_SOURCE = "edgeos-checkout-preview"

/** Sent by the preview page once it is mounted and listening. */
export interface PreviewReadyMessage {
  source: typeof PREVIEW_MESSAGE_SOURCE
  type: "ready"
}

/** Sent by the backoffice when the preview opens and on every (debounced)
 *  change to the step being edited. */
export interface PreviewStateMessage {
  source: typeof PREVIEW_MESSAGE_SOURCE
  type: "state"
  /** Short-lived token that unlocks the runtime for a popup that is still
   *  draft, and the only thing authorizing this page. Minted by the API for an
   *  authenticated operator, scoped to one popup, valid 15 minutes. See
   *  `app/utils/checkout_preview.py`. */
  previewToken: string
  /** The step open in the editor, as it currently stands — saved or not.
   *  Absent when the operator previews the checkout without editing a step,
   *  in which case the preview shows what is saved. */
  step?: TicketingStepPublic | null
}

export type PreviewMessage = PreviewReadyMessage | PreviewStateMessage

/** Narrow an untrusted `MessageEvent.data` to a preview state message. */
export function parsePreviewStateMessage(
  data: unknown,
): PreviewStateMessage | null {
  if (!data || typeof data !== "object") return null
  const message = data as Partial<PreviewStateMessage>
  if (message.source !== PREVIEW_MESSAGE_SOURCE) return null
  if (message.type !== "state") return null
  if (typeof message.previewToken !== "string" || !message.previewToken) {
    return null
  }
  // The step is optional, but a malformed one is a bug worth ignoring rather
  // than rendering half a draft over the saved checkout.
  const step = message.step
  if (
    step != null &&
    (typeof step !== "object" || typeof step.id !== "string")
  ) {
    return null
  }
  return message as PreviewStateMessage
}

/**
 * Overlay the step being edited on top of the runtime the API returned.
 *
 * Replaces the saved copy of that step when it exists, appends it otherwise
 * (a step created but not yet reloaded), and keeps the list in `order` so the
 * preview's step sequence matches the one the buyer would walk through.
 */
export function applyStepDraft(
  runtime: CheckoutRuntimeResponse,
  draft: TicketingStepPublic,
): CheckoutRuntimeResponse {
  const steps = runtime.ticketing_steps ?? []
  const index = steps.findIndex((step) => step.id === draft.id)
  const merged =
    index >= 0
      ? steps.map((step, i) => (i === index ? { ...step, ...draft } : step))
      : [...steps, draft]

  return {
    ...runtime,
    ticketing_steps: [...merged].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    ),
  }
}
