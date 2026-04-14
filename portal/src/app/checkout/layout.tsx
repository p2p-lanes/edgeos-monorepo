"use client"

import ApplicationProvider from "@/providers/applicationProvider"
import { CheckoutProvider } from "@/providers/checkoutProvider"
import CityProvider from "@/providers/cityProvider"
import DiscountProvider from "@/providers/discountProvider"
import PassesProvider from "@/providers/passesProvider"
import ThemeProvider from "@/providers/themeProvider"

const layout = ({ children }: { children: React.ReactNode }) => {
  return (
    <CityProvider public>
      <ThemeProvider>
        <ApplicationProvider>
          <DiscountProvider>
            <PassesProvider restoreFromCart>
              <CheckoutProvider>{children}</CheckoutProvider>
            </PassesProvider>
          </DiscountProvider>
        </ApplicationProvider>
      </ThemeProvider>
    </CityProvider>
  )
}

export default layout
