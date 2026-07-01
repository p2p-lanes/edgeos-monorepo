"use client"

import { usePathname } from "next/navigation"
import type * as React from "react"
import Authentication from "@/components/Authentication"
import HeaderBar from "@/components/Sidebar/HeaderBar"
import { BackofficeSidebar } from "@/components/Sidebar/Sidebar"
import { SidebarInset } from "@/components/Sidebar/SidebarComponents"
import Providers from "../../components/Providers"

export default function PortalShell({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isProfilePage = pathname === "/portal/profile"

  return (
    <Authentication>
      <Providers>
        <BackofficeSidebar collapsible="icon" />
        <SidebarInset className="max-h-svh overflow-hidden">
          {!isProfilePage && <HeaderBar />}
          {/* `id` lets pages target this exact element for scroll-position
              save/restore. `document.querySelector("main")` would resolve to
              the outer <main> rendered by SidebarInset, which has
              overflow-hidden and never scrolls — so reads return 0 and
              writes are no-ops. Keep this id stable. */}
          <main
            id="portal-scroll"
            className="flex-1 overflow-y-auto bg-background"
          >
            {children}
          </main>
        </SidebarInset>
      </Providers>
    </Authentication>
  )
}
