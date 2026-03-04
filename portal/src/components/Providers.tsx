"use client"

import "@/i18n/config"
import { SidebarProvider } from "@/components/Sidebar/SidebarComponents"
import ApplicationProvider from "@/providers/applicationProvider"
import CityProvider from "@/providers/cityProvider"
import DiscountProvider from "@/providers/discountProvider"
import { LanguageProvider } from "@/providers/languageProvider"
import PassesProvider from "@/providers/passesProvider"

const Providers = ({ children }: { children: React.ReactNode }) => {
  return (
    <CityProvider>
      <LanguageProvider>
        <ApplicationProvider>
          <DiscountProvider>
            <PassesProvider>
              <SidebarProvider>{children}</SidebarProvider>
            </PassesProvider>
          </DiscountProvider>
        </ApplicationProvider>
      </LanguageProvider>
    </CityProvider>
  )
}
export default Providers
