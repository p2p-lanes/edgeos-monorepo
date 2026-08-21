/**
 * Backoffice half of the checkout-preview contract.
 *
 * The other half lives in `portal/src/lib/checkout-preview.ts`; the two apps
 * ship separately, so the message shape is declared on both sides rather than
 * shared. Keep them in step — a mismatch shows up as a preview that never
 * leaves its loading state.
 */

import type { TicketingStepPublic } from "@/client"

export const PREVIEW_MESSAGE_SOURCE = "edgeos-checkout-preview"

/** Posted by the preview iframe once it is mounted and listening. */
export interface PreviewReadyMessage {
  source: typeof PREVIEW_MESSAGE_SOURCE
  type: "ready"
}

/** Posted by this app when the preview opens, and again on every (debounced)
 *  change to the step being edited. */
export interface PreviewStateMessage {
  source: typeof PREVIEW_MESSAGE_SOURCE
  type: "state"
  previewToken: string
  /** The step open in the editor, unsaved changes included. Omitted when the
   *  operator previews the checkout without editing a step. */
  step?: TicketingStepPublic | null
}

export function isPreviewReadyMessage(data: unknown): boolean {
  if (!data || typeof data !== "object") return false
  const message = data as Partial<PreviewReadyMessage>
  return message.source === PREVIEW_MESSAGE_SOURCE && message.type === "ready"
}

export function buildPreviewStateMessage(
  previewToken: string,
  step: TicketingStepPublic | null,
): PreviewStateMessage {
  return {
    source: PREVIEW_MESSAGE_SOURCE,
    type: "state",
    previewToken,
    step,
  }
}
