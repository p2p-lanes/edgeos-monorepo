"use client"

import ApplicationProvider from "@/providers/applicationProvider"
import { CheckoutProvider } from "@/providers/checkoutProvider"
import CityProvider from "@/providers/cityProvider"
import DiscountProvider from "@/providers/discountProvider"
import PassesProvider from "@/providers/passesProvider"
import QueryProvider from "@/providers/queryProvider"

const layout = ({ children }: { children: React.ReactNode }) => {
  return (
    <QueryProvider>
      <CityProvider>
        <ApplicationProvider>
          <DiscountProvider>
            <PassesProvider>
              <CheckoutProvider>{children}</CheckoutProvider>
            </PassesProvider>
          </DiscountProvider>
        </ApplicationProvider>
      </CityProvider>
    </QueryProvider>
  )
}
export default layout
