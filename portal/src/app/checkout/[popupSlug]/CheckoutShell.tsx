"use client"

import type { ReactNode } from "react"
import type { PopupPublic } from "@/client"
import { CheckoutBackgroundImage } from "@/components/CheckoutBackgroundImage"
import { CheckoutBackgroundVideo } from "@/components/CheckoutBackgroundVideo"
import { SidebarProvider } from "@/components/Sidebar/SidebarComponents"
import { getCheckoutBackground } from "@/lib/background-image"

/** Page chrome around the checkout: the popup's configured background and the
 *  collapsed sidebar the flow renders inside. Shared by the buyer-facing page
 *  and the backoffice preview so both sit on the same canvas. */
export function CheckoutShell({
  popup,
  children,
}: {
  popup: PopupPublic
  children: ReactNode
}) {
  const background = getCheckoutBackground(popup, "checkout")

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
        {children}
      </main>
    </SidebarProvider>
  )
}
