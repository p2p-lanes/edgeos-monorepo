"use client"

import { useParams } from "next/navigation"
import { useTranslation } from "react-i18next"
import { CheckoutBackgroundImage } from "@/components/CheckoutBackgroundImage"
import { CheckoutBackgroundVideo } from "@/components/CheckoutBackgroundVideo"
import { OpenCheckoutRuntime } from "@/components/checkout-flow/OpenCheckoutRuntime"
import { SidebarProvider } from "@/components/Sidebar/SidebarComponents"
import useAuth from "@/hooks/useAuth"
import { getCheckoutBackground } from "@/lib/background-image"
import { useCheckoutRuntime } from "./hooks/useCheckoutRuntime"

export default function OpenTicketingCheckoutPage() {
  const { t } = useTranslation()
  const params = useParams<{ popupSlug: string }>()
  const popupSlug = params.popupSlug
  const { data: runtime, isLoading, isError } = useCheckoutRuntime(popupSlug)
  const { user } = useAuth()

  const prefilledBuyer = user
    ? {
        email: user.email,
        firstName: user.first_name ?? "",
        lastName: user.last_name ?? "",
      }
    : undefined

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-muted-foreground">
          {t("openCheckout.loading")}
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
