"use client"

import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { CheckoutService, type TicketingStepPublic } from "@/client"
import { OpenCheckoutRuntime } from "@/components/checkout-flow/OpenCheckoutRuntime"
import { Loader } from "@/components/ui/Loader"
import {
  applyStepDraft,
  isAllowedPreviewOrigin,
  PREVIEW_MESSAGE_SOURCE,
  type PreviewReadyMessage,
  parsePreviewStateMessage,
} from "@/lib/checkout-preview"
import {
  resolveRequestLanguage,
  subscribeRequestLanguage,
} from "@/lib/language-storage"
import { CheckoutShell } from "../CheckoutShell"

interface PreviewState {
  previewToken: string
  /** Null when the operator is previewing the checkout without a step open. */
  step: TicketingStepPublic | null
}

/**
 * Renders the real checkout for the backoffice's ticketing-step editor.
 *
 * Nothing renders until an allowed origin posts in a preview token: that is
 * what lets the public runtime endpoint serve a popup that is still draft. The
 * flow then starts where a buyer's would. If a step is open in the editor it
 * rides along and is overlaid on the saved data, so unsaved work shows up.
 * Everything else — products, theme, buyer form — is fetched from the API the
 * same way a buyer's checkout fetches it, so what shows up here is what ships.
 */
export default function CheckoutPreviewClient({
  popupSlug,
  allowedOrigins,
}: {
  popupSlug: string
  /** Resolved on the server, per request — see the route's page.tsx. */
  allowedOrigins: string[]
}) {
  const [state, setState] = useState<PreviewState | null>(null)
  // Prop identity changes on every server render; the effect below only cares
  // about the values.
  const originsKey = allowedOrigins.join(",")
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the joined value so a re-render with an equal list doesn't re-run the handshake
  const origins = useMemo(() => allowedOrigins, [originsKey])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (origins.length === 0) return

    const onMessage = (event: MessageEvent) => {
      if (!isAllowedPreviewOrigin(event.origin, origins)) return
      const message = parsePreviewStateMessage(event.data)
      if (!message) return
      setState({
        previewToken: message.previewToken,
        step: message.step ?? null,
      })
    }

    window.addEventListener("message", onMessage)

    // Announce readiness to the embedder. Posted to each allowed origin
    // explicitly rather than "*", so the handshake is never broadcast to a
    // page that happens to frame this one.
    const ready: PreviewReadyMessage = {
      source: PREVIEW_MESSAGE_SOURCE,
      type: "ready",
    }
    for (const origin of origins) {
      window.parent?.postMessage(ready, origin)
    }

    return () => window.removeEventListener("message", onMessage)
  }, [origins])

  // Held in state, exactly like the buyer page. Resolving it during render
  // instead would read a value the render itself changes: the language provider
  // publishes the active language when it mounts, and it mounts inside the flow
  // this component renders once the runtime arrives. The query key would then
  // change on the render after the fetch, start a second fetch, drop back to
  // the loading state, unmount the provider — and oscillate.
  const [language, setLanguage] = useState(resolveRequestLanguage)
  useEffect(() => {
    setLanguage(resolveRequestLanguage())
    return subscribeRequestLanguage(() => setLanguage(resolveRequestLanguage()))
  }, [])

  const {
    data: runtime,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["checkout-preview-runtime", popupSlug, language],
    queryFn: () =>
      CheckoutService.getRuntime({
        slug: popupSlug,
        xCheckoutPreviewToken: state?.previewToken,
      }),
    enabled: !!state?.previewToken,
    staleTime: 30_000,
    retry: false,
  })

  const patched = useMemo(() => {
    if (!runtime) return null
    return state?.step ? applyStepDraft(runtime, state.step) : runtime
  }, [runtime, state])

  if (origins.length === 0) {
    return (
      <PreviewNotice
        title="Preview not configured"
        detail="This portal does not know which backoffice may drive the preview. Set BACKOFFICE_URL (or BACKOFFICE_ORIGIN, for more than one) on the portal service and restart it."
      />
    )
  }

  if (!state || isLoading) {
    return <Loader />
  }

  if (isError || !patched) {
    return (
      <PreviewNotice
        title="Preview unavailable"
        detail="The checkout data for this event could not be loaded. The preview link may have expired — close and reopen the preview."
      />
    )
  }

  return (
    <CheckoutShell popup={patched.popup}>
      <OpenCheckoutRuntime
        runtime={patched}
        popupSlug={popupSlug}
        previewMode
      />
    </CheckoutShell>
  )
}

function PreviewNotice({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}
