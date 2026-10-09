"use client"

import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ApiError, ThirdPartySsoService } from "@/client"
import { Button } from "@/components/ui/button"
import { Loader } from "@/components/ui/Loader"
import "@/lib/api-client"

/** Trusted portal UI performs auth; untrusted custom-home HTML remains scriptless. */
export function ThirdPartyAppLaunch({
  authorize = false,
}: {
  authorize?: boolean
}) {
  const { popupSlug, appId } = useParams<{ popupSlug: string; appId: string }>()
  const search = useSearchParams()
  const query = search.toString()
  const { t } = useTranslation()
  const [error, setError] = useState(false)
  const action = useRef<{ key: string; promise: Promise<string> } | null>(null)

  useEffect(() => {
    let active = true
    const key = JSON.stringify([popupSlug, appId, authorize, query])
    // Reuse the in-flight operation across React StrictMode effects. A cleanup
    // cancels navigation, not the POST; remounting must not issue another code.
    if (action.current?.key !== key) {
      setError(false)
      const run = async () => {
        if (authorize) {
          const params = new URLSearchParams(query)
          const response = await ThirdPartySsoService.createSsoCode({
            slug: popupSlug,
            appId,
            requestBody: {
              state: params.get("state") ?? "",
              code_challenge: params.get("code_challenge") ?? "",
              code_challenge_method: params.get("code_challenge_method") ?? "",
            },
          })
          return response.redirect_url
        }
        const app = await ThirdPartySsoService.getSsoLaunch({
          slug: popupSlug,
          appId,
        })
        const target = new URL(app.start_url)
        const callback = new URL(
          `/portal/${encodeURIComponent(popupSlug)}/apps/${encodeURIComponent(appId)}/authorize`,
          window.location.origin,
        )
        target.searchParams.set("authorize_url", callback.toString())
        return target.toString()
      }
      action.current = { key, promise: run() }
    }
    action.current.promise
      .then((url) => {
        if (active) window.location.replace(url)
      })
      .catch((err: unknown) => {
        if (active) {
          // Don't log error bodies/URLs: they can include transaction values.
          if (err instanceof ApiError && err.status === 401) {
            localStorage.removeItem("token")
            window.location.reload() // Existing Authentication handles returnTo.
          } else setError(true)
        }
      })
    return () => {
      active = false
    }
  }, [popupSlug, appId, authorize, query])

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-6 py-16 text-center">
      {error ? (
        <>
          <h1 className="text-xl font-semibold">
            {t("sso.errorTitle", { defaultValue: "Could not open the app" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("sso.errorDescription", {
              defaultValue:
                "The app is unavailable or this connection attempt is invalid. Return to the home page and try again.",
            })}
          </p>
          <Button asChild>
            <Link href={`/portal/${encodeURIComponent(popupSlug)}`}>
              {t("sso.back", { defaultValue: "Back to home" })}
            </Link>
          </Button>
        </>
      ) : (
        <>
          <Loader />
          <output className="text-sm text-muted-foreground">
            {t("sso.opening", { defaultValue: "Opening app…" })}
          </output>
        </>
      )}
    </div>
  )
}
