"use client"

import { usePathname } from "next/navigation"
import type * as React from "react"
import Authentication from "@/components/Authentication"
import ProfileCompletionReminder from "@/components/profile/ProfileCompletionReminder"
import HeaderBar from "@/components/Sidebar/HeaderBar"
import { BackofficeSidebar } from "@/components/Sidebar/Sidebar"
import {
  SidebarInset,
  SidebarTrigger,
} from "@/components/Sidebar/SidebarComponents"
import { cn } from "@/lib/utils"
import Providers from "../../components/Providers"

/** Checkout keeps its immersive canvas without the Portal header, but below
 *  the sidebar's mobile breakpoint (lg) the sidebar is an off-canvas sheet and
 *  the header was its only trigger. This bar restores that trigger. Its height
 *  is published as `--checkout-chrome-top` on the scroll container so the
 *  checkout shell and skins with fixed chrome can make room for it. */
function CheckoutSidebarBar() {
  return (
    <div className="portal-chrome flex h-12 shrink-0 items-center border-b bg-sidebar px-3 text-nav-text lg:hidden">
      <SidebarTrigger />
    </div>
  )
}

export default function PortalShell({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isProfilePage = pathname === "/portal/profile"
  const segments = pathname.split("/").filter(Boolean)
  const isCheckoutPage =
    segments[0] === "portal" &&
    segments.length >= 4 &&
    ((segments[2] === "shop" && Boolean(segments[3])) ||
      (segments[2] === "passes" && segments[3] === "buy"))

  return (
    <Authentication>
      <Providers>
        <BackofficeSidebar collapsible="icon" />
        <SidebarInset className="portal-chrome max-h-svh overflow-hidden bg-muted/30 text-foreground">
          {!isProfilePage && !isCheckoutPage && <HeaderBar />}
          {!isProfilePage && !isCheckoutPage && <ProfileCompletionReminder />}
          {isCheckoutPage && <CheckoutSidebarBar />}
          {/* `id` lets pages target this exact element for scroll-position
              save/restore. `document.querySelector("main")` would resolve to
              the outer <main> rendered by SidebarInset, which has
              overflow-hidden and never scrolls — so reads return 0 and
              writes are no-ops. Keep this id stable. */}
          <main
            id="portal-scroll"
            className={cn(
              "portal-chrome flex-1 overflow-y-auto bg-background",
              isCheckoutPage && "max-lg:[--checkout-chrome-top:3rem]",
            )}
          >
            {children}
          </main>
        </SidebarInset>
      </Providers>
    </Authentication>
  )
}
