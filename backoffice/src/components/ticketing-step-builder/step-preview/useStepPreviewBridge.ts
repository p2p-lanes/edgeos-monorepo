import { type RefObject, useCallback, useEffect, useRef, useState } from "react"

import type { TicketingStepPublic } from "@/client"
import {
  buildPreviewStateMessage,
  isPreviewReadyMessage,
} from "./previewProtocol"

/** How long to wait after the last keystroke before re-rendering the preview.
 *  Long enough that typing a title doesn't re-render on every character, short
 *  enough that the change still feels immediate. */
const DEBOUNCE_MS = 300

interface UseStepPreviewBridgeArgs {
  iframeRef: RefObject<HTMLIFrameElement | null>
  /** Origin of the iframe. Messages are only posted here, and only accepted
   *  from here. */
  targetOrigin: string | null
  previewToken: string | null
  /** The step open in the editor, unsaved changes included, or null when the
   *  checkout is being previewed on its own. */
  step: TicketingStepPublic | null
}

/**
 * Drives the embedded preview.
 *
 * The iframe announces itself when it mounts; the token goes across right
 * away — without it the portal cannot read a checkout that is still draft — and
 * from then on every change to the open step is posted too, debounced.
 */
export function useStepPreviewBridge({
  iframeRef,
  targetOrigin,
  previewToken,
  step,
}: UseStepPreviewBridgeArgs) {
  const [isReady, setIsReady] = useState(false)

  // Read inside the debounce timer, so a change that lands mid-wait is sent
  // with the latest values instead of the ones captured when it started.
  const latestRef = useRef({ previewToken, step })
  latestRef.current = { previewToken, step }

  const post = useCallback(() => {
    const frame = iframeRef.current?.contentWindow
    const { previewToken: token, step: draft } = latestRef.current
    // The step is optional; the token is not.
    if (!frame || !targetOrigin || !token) return
    frame.postMessage(buildPreviewStateMessage(token, draft), targetOrigin)
  }, [iframeRef, targetOrigin])

  // The iframe may mount before the token resolves, or reload (language
  // switch, manual refresh) after it did — so the handshake is what triggers
  // the first send, in both directions.
  useEffect(() => {
    if (!targetOrigin) return

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== targetOrigin) return
      if (!isPreviewReadyMessage(event.data)) return
      setIsReady(true)
      post()
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [targetOrigin, post])

  // Debounced resend on every draft change. `serialized` and `previewToken`
  // are the trigger; the body reads both through `latestRef` so a change
  // landing mid-wait is still sent with the newest values. The token is
  // load-bearing here: it can resolve after the handshake, and without it the
  // preview would sit empty until the operator happened to edit something.
  const serialized = JSON.stringify(step)
  // biome-ignore lint/correctness/useExhaustiveDependencies: serialized/previewToken are change triggers, read via latestRef rather than captured
  useEffect(() => {
    if (!isReady) return
    const timer = setTimeout(post, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [serialized, previewToken, isReady, post])

  /** Call after remounting the iframe (reload / language switch): the new
   *  document has to hand-shake again before it can be driven. */
  const reset = useCallback(() => setIsReady(false), [])

  return { isReady, reset }
}
