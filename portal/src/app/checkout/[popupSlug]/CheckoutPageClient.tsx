"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { ApiError, type CheckoutRuntimeResponse } from "@/client"
import { CheckoutBackgroundImage } from "@/components/CheckoutBackgroundImage"
import { CheckoutBackgroundVideo } from "@/components/CheckoutBackgroundVideo"
import { OpenCheckoutRuntime } from "@/components/checkout-flow/OpenCheckoutRuntime"
import { SidebarProvider } from "@/components/Sidebar/SidebarComponents"
import { Button } from "@/components/ui/button"
import { Loader } from "@/components/ui/Loader"
import useAuth from "@/hooks/useAuth"
import { getCheckoutBackground } from "@/lib/background-image"
import {
  resolveRequestLanguage,
  subscribeRequestLanguage,
} from "@/lib/language-storage"
import { getAuthRedirectPath } from "@/lib/safe-return-to"
import { useCheckoutRuntime } from "./hooks/useCheckoutRuntime"

interface CheckoutPageClientProps {
  popupSlug: string
  /**
   * Named sales flow (sdd/sales-flows D6 URL scheme —
   * `/checkout/{popupSlug}/{flowSlug}`). Omitted resolves the popup's
   * default flow, matching the legacy 2-segment route.
   */
  flowSlug?: string
  initialRuntime?: CheckoutRuntimeResponse
  initialDataUpdatedAt?: number
  /** Language the server render fetched `initialRuntime` in, if any. */
  initialRuntimeLanguage?: string | null
}

export default function CheckoutPageClient({
  popupSlug,
  flowSlug,
  initialRuntime,
  initialDataUpdatedAt,
  initialRuntimeLanguage = null,
}: CheckoutPageClientProps) {
  const { t } = useTranslation()
  // Resolved in a state initializer rather than an effect so the very first
  // client render already keys on the right language — the rendered output is
  // identical either way (initialRuntime drives it), so hydration is safe.
  // The subscription re-keys on a mid-session switch, which is what keeps a
  // language's payload from being cached under another language's key.
  const [language, setLanguage] = useState(resolveRequestLanguage)
  useEffect(() => {
    setLanguage(resolveRequestLanguage())
    return subscribeRequestLanguage(() => setLanguage(resolveRequestLanguage()))
  }, [])

  // The server had no access to localStorage, so it may have rendered in a
  // different language than the visitor's stored choice. Keep showing that
  // payload (a spinner would be worse) but hand it over already stale, so
  // react-query refetches on mount instead of sitting on it for the staleTime.
  const initialMatchesLanguage = language === initialRuntimeLanguage

  const {
    data: runtime,
    isLoading,
    isError,
    error,
  } = useCheckoutRuntime(popupSlug, {
    language,
    flowSlug,
    initialData: initialRuntime,
    initialDataUpdatedAt: initialMatchesLanguage ? initialDataUpdatedAt : 0,
  })
  const { user } = useAuth()

  const prefilledBuyer = user
    ? {
        email: user.email,
        firstName: user.first_name ?? "",
        lastName: user.last_name ?? "",
      }
    : undefined

  if (isLoading) {
    return <Loader />
  }

  // The runtime endpoint returns 401 for flows restricted to signed-in
  // attendees (e.g. upsale flows). The link is valid; the visitor just needs
  // to sign in, so send them to the auth flow and back to this checkout.
  if (error instanceof ApiError && error.status === 401) {
    const checkoutPath = flowSlug
      ? `/checkout/${popupSlug}/${flowSlug}`
      : `/checkout/${popupSlug}`
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold">
            {t("openCheckout.sign_in_required_title")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("openCheckout.sign_in_required_description")}
          </p>
          <Button asChild className="mt-6">
            <Link href={getAuthRedirectPath(checkoutPath)}>
              {t("openCheckout.sign_in_required_cta")}
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  if (isError || !runtime) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold">
            {t("openCheckout.unavailable_title")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("openCheckout.unavailable_description")}
          </p>
        </div>
      </div>
    )
  }

  const background = getCheckoutBackground(runtime.popup, "checkout")

  return (
    <SidebarProvider
      defaultOpen={false}
      className="block min-h-0"
      style={
        {
          "--sidebar-width": "0px",
          "--sidebar-width-icon": "0px",
        } as React.CSSProperties
      }
    >
      <main
        className={`h-svh overflow-y-auto no-scrollbar ${background.type === "none" ? "bg-background" : ""}`.trim()}
      >
        {background.type === "image" && (
          <CheckoutBackgroundImage url={background.url} />
        )}
        {background.type === "video" && (
          <CheckoutBackgroundVideo url={background.url} />
        )}
        <OpenCheckoutRuntime
          runtime={runtime}
          popupSlug={popupSlug}
          prefilledBuyer={prefilledBuyer}
        />
      </main>
    </SidebarProvider>
  )
}
