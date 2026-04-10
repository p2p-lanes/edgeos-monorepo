"use client"

import { SidebarProvider } from "@/components/Sidebar/SidebarComponents"
import { TooltipProvider } from "@/components/ui/tooltip"
import ApplicationProvider from "@/providers/applicationProvider"
import CityProvider from "@/providers/cityProvider"
import DiscountProvider from "@/providers/discountProvider"
import PassesProvider from "@/providers/passesProvider"
import ThemeProvider from "@/providers/themeProvider"

const Providers = ({ children }: { children: React.ReactNode }) => {
  return (
    <CityProvider>
      <ThemeProvider>
        <TooltipProvider>
          <ApplicationProvider>
            <DiscountProvider>
              <PassesProvider>
                <SidebarProvider>{children}</SidebarProvider>
              </PassesProvider>
            </DiscountProvider>
          </ApplicationProvider>
        </TooltipProvider>
      </ThemeProvider>
    </CityProvider>
  )
}
export default Providers
