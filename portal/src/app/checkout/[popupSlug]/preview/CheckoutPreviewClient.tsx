"use client"

import { useQuery } from "@tanstack/react-query"
import { useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { CheckoutService, type TicketingStepPublic } from "@/client"
import { OpenCheckoutRuntime } from "@/components/checkout-flow/OpenCheckoutRuntime"
import { Loader } from "@/components/ui/Loader"
import {
  applyStepDraft,
  PREVIEW_MESSAGE_SOURCE,
  type PreviewReadyMessage,
  parsePreviewStateMessage,
} from "@/lib/checkout-preview"
import {
  resolveRequestLanguage,
  subscribeRequestLanguage,
} from "@/lib/language-storage"
import ThemeProvider, { type ThemeConfig } from "@/providers/themeProvider"
import { CheckoutShell } from "../CheckoutShell"

interface PreviewState {
  previewToken: string
  /** Null when the operator is previewing the checkout without a step open. */
  step: TicketingStepPublic | null
}

/**
 * Renders the real checkout for the backoffice's ticketing-step editor.
 *
 * Nothing renders until the embedder posts in a preview token: that is what
 * lets the public runtime endpoint serve a popup that is still draft, and it is
 * what authorizes this page — see the trust model in `lib/checkout-preview`.
 * The flow then starts where a buyer's would. If a step is open in the editor
 * it rides along and is overlaid on the saved data, so unsaved work shows up.
 * Everything else — products, theme, buyer form — is fetched from the API the
 * same way a buyer's checkout fetches it, so what shows up here is what ships.
 */
export default function CheckoutPreviewClient({
  popupSlug,
}: {
  popupSlug: string
}) {
  const searchParams = useSearchParams()
  const flowSlug = searchParams.get("flow")
  const [state, setState] = useState<PreviewState | null>(null)
  const [isFramed, setIsFramed] = useState(true)

  useEffect(() => {
    if (typeof window === "undefined") return
    // This page is only ever an iframe in the backoffice. Standing alone it can
    // never be driven, so say that instead of spinning forever.
    const parent = window.parent
    if (!parent || parent === window) {
      setIsFramed(false)
      return
    }

    const onMessage = (event: MessageEvent) => {
      // Only the embedder drives this page — not an opener, not a sibling
      // frame. Its origin is deliberately not checked: see the trust model.
      if (event.source !== parent) return
      const message = parsePreviewStateMessage(event.data)
      if (!message) return
      setState({
        previewToken: message.previewToken,
        step: message.step ?? null,
      })
    }

    window.addEventListener("message", onMessage)

    // Announce readiness to the embedder. Broadcast, because the whole point of
    // this design is that the portal needs no configuration to name the
    // backoffice — and this message carries nothing but a constant string. The
    // token travels the other way, and that direction is pinned to an exact
    // origin by the sender.
    const ready: PreviewReadyMessage = {
      source: PREVIEW_MESSAGE_SOURCE,
      type: "ready",
    }
    parent.postMessage(ready, "*")

    return () => window.removeEventListener("message", onMessage)
  }, [])

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
    queryKey: ["checkout-preview-runtime", popupSlug, flowSlug, language],
    queryFn: () =>
      CheckoutService.getFlowRuntime({
        slug: popupSlug,
        flowSlug: flowSlug ?? "",
        xCheckoutPreviewToken: state?.previewToken,
      }),
    enabled: !!state?.previewToken && !!flowSlug,
    staleTime: 30_000,
    retry: false,
  })

  const patched = useMemo(() => {
    if (!runtime) return null
    return state?.step ? applyStepDraft(runtime, state.step) : runtime
  }, [runtime, state])

  if (!isFramed) {
    return (
      <PreviewNotice
        title="Nothing to preview here"
        detail="This page renders a checkout preview for the backoffice, which drives it from inside an editor. Open it from Ticketing steps → Preview checkout."
      />
    )
  }

  if (!state || isLoading) {
    return <Loader />
  }

  if (!flowSlug) {
    return (
      <PreviewNotice
        title="Preview unavailable"
        detail="No sales flow was selected for this checkout preview."
      />
    )
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
    <ThemeProvider
      config={patched.theme_config as ThemeConfig | null}
      scope="local"
    >
      <CheckoutShell popup={patched.popup}>
        <OpenCheckoutRuntime
          runtime={patched}
          popupSlug={popupSlug}
          flowSlug={flowSlug}
          previewMode
        />
      </CheckoutShell>
    </ThemeProvider>
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
