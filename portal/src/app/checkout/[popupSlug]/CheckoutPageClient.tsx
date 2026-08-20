"use client"

import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { CheckoutRuntimeResponse } from "@/client"
import { OpenCheckoutRuntime } from "@/components/checkout-flow/OpenCheckoutRuntime"
import { Loader } from "@/components/ui/Loader"
import useAuth from "@/hooks/useAuth"
import {
  resolveRequestLanguage,
  subscribeRequestLanguage,
} from "@/lib/language-storage"
import { CheckoutShell } from "./CheckoutShell"
import { useCheckoutRuntime } from "./hooks/useCheckoutRuntime"

interface CheckoutPageClientProps {
  popupSlug: string
  initialRuntime?: CheckoutRuntimeResponse
  initialDataUpdatedAt?: number
  /** Language the server render fetched `initialRuntime` in, if any. */
  initialRuntimeLanguage?: string | null
}

export default function CheckoutPageClient({
  popupSlug,
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
  } = useCheckoutRuntime(popupSlug, {
    language,
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

  return (
    <CheckoutShell popup={runtime.popup}>
      <OpenCheckoutRuntime
        runtime={runtime}
        popupSlug={popupSlug}
        prefilledBuyer={prefilledBuyer}
      />
    </CheckoutShell>
  )
}
