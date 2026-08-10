"use client"

import "@/i18n/config"
import type { ReactNode } from "react"
import { sortAttendees } from "@/helpers/filters"
import ApplicationProvider, {
  useApplication,
} from "@/providers/applicationProvider"
import { CheckoutProvider } from "@/providers/checkoutProvider"
import CityProvider from "@/providers/cityProvider"
import DiscountProvider from "@/providers/discountProvider"
import { LanguageProvider } from "@/providers/languageProvider"
import PassesProvider from "@/providers/passesProvider"

const CheckoutBridge = ({ children }: { children: ReactNode }) => {
  const { getAttendees } = useApplication()
  const attendees = sortAttendees(getAttendees())

  return (
    <PassesProvider attendees={attendees} restoreFromCart>
      <CheckoutProvider>{children}</CheckoutProvider>
    </PassesProvider>
  )
}

/**
 * ThemeProvider is deliberately NOT here.
 *
 * A flow chooses how its checkout looks (sdd/sales-flows-rediseno), and
 * the flow is only known once the runtime has loaded — below this point.
 * `CheckoutPageClient` mounts the provider with the flow's theme, so there
 * is exactly one writer to the CSS variables instead of a parent and a
 * child racing on effect order.
 */
const PublicCheckoutProviders = ({ children }: { children: ReactNode }) => {
  return (
    <CityProvider public>
      <LanguageProvider>
        <ApplicationProvider>
          <DiscountProvider>
            <CheckoutBridge>{children}</CheckoutBridge>
          </DiscountProvider>
        </ApplicationProvider>
      </LanguageProvider>
    </CityProvider>
  )
}

export default PublicCheckoutProviders
