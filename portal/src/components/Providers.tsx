"use client"

import "@/i18n/config"
import type { ReactNode } from "react"
import { SidebarProvider } from "@/components/Sidebar/SidebarComponents"
import { TooltipProvider } from "@/components/ui/tooltip"
import useResolvedAttendees from "@/hooks/useResolvedAttendees"
import ApplicationProvider from "@/providers/applicationProvider"
import CityProvider from "@/providers/cityProvider"
import DiscountProvider from "@/providers/discountProvider"
import { LanguageProvider } from "@/providers/languageProvider"
import PassesProvider from "@/providers/passesProvider"
import ThemeProvider from "@/providers/themeProvider"

/**
 * Bridges `useResolvedAttendees` (which branches on sale_type) into the
 * `PassesProvider` `attendees` prop. Must live inside ApplicationProvider
 * and CityProvider so the hook can read both.
 */
const PassesBridge = ({ children }: { children: ReactNode }) => {
  const attendees = useResolvedAttendees()
  return <PassesProvider attendees={attendees}>{children}</PassesProvider>
}

const Providers = ({ children }: { children: ReactNode }) => {
  return (
    <CityProvider>
      <ThemeProvider>
        <LanguageProvider>
          <TooltipProvider>
            <ApplicationProvider>
              <DiscountProvider>
                <PassesBridge>
                  <SidebarProvider>{children}</SidebarProvider>
                </PassesBridge>
              </DiscountProvider>
            </ApplicationProvider>
          </TooltipProvider>
        </LanguageProvider>
      </ThemeProvider>
    </CityProvider>
  )
}
export default Providers
