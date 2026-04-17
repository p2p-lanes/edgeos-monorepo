"use client"

import "@/i18n/config"
import ApplicationProvider from "@/providers/applicationProvider"
import { CheckoutProvider } from "@/providers/checkoutProvider"
import CityProvider from "@/providers/cityProvider"
import DiscountProvider from "@/providers/discountProvider"
import { LanguageProvider } from "@/providers/languageProvider"
import PassesProvider from "@/providers/passesProvider"
import ThemeProvider from "@/providers/themeProvider"

const layout = ({ children }: { children: React.ReactNode }) => {
  return (
    <CityProvider public>
      <ThemeProvider>
        <LanguageProvider>
          <ApplicationProvider>
            <DiscountProvider>
              <PassesProvider restoreFromCart>
                <CheckoutProvider>{children}</CheckoutProvider>
              </PassesProvider>
            </DiscountProvider>
          </ApplicationProvider>
        </LanguageProvider>
      </ThemeProvider>
    </CityProvider>
  )
}

export default layout
