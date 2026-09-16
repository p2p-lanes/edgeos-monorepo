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
import ThemeProvider from "@/providers/themeProvider"

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
 * Despite the name, this wraps the invite, group and referral landing
 * pages — `/invite`, `/groups`, `/r` — not `/checkout`, which mounts its
 * own providers in `CheckoutPageClient`.
 *
 * ThemeProvider belongs here because those pages have no sales flow in
 * scope: they dress in the gathering's theme, the same as the portal. The
 * checkout mounts its own with the flow's theme instead.
 */
const PublicCheckoutProviders = ({ children }: { children: ReactNode }) => {
  return (
    <CityProvider public>
      <ThemeProvider>
        <LanguageProvider>
          <ApplicationProvider>
            <DiscountProvider>
              <CheckoutBridge>{children}</CheckoutBridge>
            </DiscountProvider>
          </ApplicationProvider>
        </LanguageProvider>
      </ThemeProvider>
    </CityProvider>
  )
}

export default PublicCheckoutProviders
