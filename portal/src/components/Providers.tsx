"use client"

import { SidebarProvider } from "@/components/Sidebar/SidebarComponents"
import ApplicationProvider from "@/providers/applicationProvider"
import CityProvider from "@/providers/cityProvider"
import DiscountProvider from "@/providers/discountProvider"
import PassesProvider from "@/providers/passesProvider"
import ThemeProvider from "@/providers/themeProvider"

const Providers = ({ children }: { children: React.ReactNode }) => {
  return (
    <CityProvider>
      <ThemeProvider>
        <ApplicationProvider>
          <DiscountProvider>
            <PassesProvider>
              <SidebarProvider>{children}</SidebarProvider>
            </PassesProvider>
          </DiscountProvider>
        </ApplicationProvider>
      </ThemeProvider>
    </CityProvider>
  )
}
export default Providers
