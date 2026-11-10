"use client"

import type * as React from "react"
import { useHasNoPortalPopups } from "@/hooks/useHasNoPortalPopups"
import FooterMenu from "./FooterMenu"
import PopupsMenu from "./PopupsMenu"
import ResourcesMenu from "./ResourcesMenu"
import { Sidebar } from "./SidebarComponents"

export function BackofficeSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  if (useHasNoPortalPopups()) return null

  return (
    <Sidebar className="portal-chrome portal-sidebar" {...props}>
      <PopupsMenu />
      <ResourcesMenu />
      <FooterMenu />
    </Sidebar>
  )
}
