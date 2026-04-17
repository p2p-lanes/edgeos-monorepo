"use client"

import "@/i18n/config"
import { SidebarProvider } from "@/components/Sidebar/SidebarComponents"
import { TooltipProvider } from "@/components/ui/tooltip"
import ApplicationProvider from "@/providers/applicationProvider"
import CityProvider from "@/providers/cityProvider"
import DiscountProvider from "@/providers/discountProvider"
import { LanguageProvider } from "@/providers/languageProvider"
import PassesProvider from "@/providers/passesProvider"
import ThemeProvider from "@/providers/themeProvider"

const Providers = ({ children }: { children: React.ReactNode }) => {
  return (
    <CityProvider>
      <ThemeProvider>
        <LanguageProvider>
          <TooltipProvider>
            <ApplicationProvider>
              <DiscountProvider>
                <PassesProvider>
                  <SidebarProvider>{children}</SidebarProvider>
                </PassesProvider>
              </DiscountProvider>
            </ApplicationProvider>
          </TooltipProvider>
        </LanguageProvider>
      </ThemeProvider>
    </CityProvider>
  )
}
export default Providers
