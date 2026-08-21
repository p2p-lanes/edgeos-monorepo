/**
 * Contract between the backoffice's ticketing-step editor and the checkout
 * preview page it embeds in an iframe.
 *
 * The preview renders the real checkout — same shell, skin, theme and variants
 * a buyer sees — so the operator never has to guess how a step will look. The
 * portal fetches the event's own data from the API exactly like production
 * does; the only thing that crosses the iframe boundary is the step being
 * edited, so unsaved changes show up without a round trip through the database.
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
   *  draft. See `app/utils/checkout_preview.py`. */
  previewToken: string
  /** The step open in the editor, as it currently stands — saved or not.
   *  Absent when the operator previews the checkout without editing a step,
   *  in which case the preview shows what is saved. */
  step?: TicketingStepPublic | null
}

export type PreviewMessage = PreviewReadyMessage | PreviewStateMessage

/**
 * Parse the configured origins (comma-separated) into a match list.
 *
 * Takes one value or several — the caller passes every variable that may carry
 * an origin, and they are unioned rather than ranked, so a blank or missing one
 * can never mask a good one. Orchestrators routinely materialize an unset
 * variable as the empty string (`BACKOFFICE_ORIGIN=${BACKOFFICE_ORIGIN-}` in a
 * compose file does exactly that), which is indistinguishable from unset here
 * and must be treated as such.
 *
 * Each value is normalized through `URL.origin`, so a trailing slash or a path
 * — `https://app.example.com/` — still matches the bare origin a message
 * carries, instead of silently never matching. Anything unparseable is
 * dropped.
 *
 * An empty result means no origin is trusted and the preview stays idle:
 * deliberately fail-closed, since a message decides what this page renders and
 * which token it spends.
 */
export function parsePreviewOrigins(
  raw: string | null | undefined | Array<string | null | undefined>,
): string[] {
  const sources = Array.isArray(raw) ? raw : [raw]
  const origins = sources
    .filter((source): source is string => typeof source === "string")
    .flatMap((source) => source.split(","))
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => {
      try {
        return [new URL(value).origin]
      } catch {
        return []
      }
    })

  return [...new Set(origins)]
}

export function isAllowedPreviewOrigin(
  origin: string,
  allowed: string[],
): boolean {
  return allowed.includes(origin)
}

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
