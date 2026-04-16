"use client"

import "@/i18n/config"
import { type ReactNode, useMemo } from "react"
import Authentication from "@/components/Authentication"
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

/**
 * Resolves attendees via `useApplication` and threads them into
 * PassesProvider. The legacy `/checkout` route is always group/application
 * flow (direct-sale lives at `/portal/{slug}`), so we can read the
 * application directly here without branching on sale_type.
 */
const CheckoutBridge = ({ children }: { children: ReactNode }) => {
  const { getAttendees } = useApplication()
  const attendees = useMemo(() => sortAttendees(getAttendees()), [getAttendees])

  return (
    <PassesProvider attendees={attendees} restoreFromCart>
      <CheckoutProvider>{children}</CheckoutProvider>
    </PassesProvider>
  )
}

const layout = ({ children }: { children: ReactNode }) => {
  return (
    <CityProvider public>
      <ThemeProvider>
        <LanguageProvider>
          <Authentication>
            <ApplicationProvider>
              <DiscountProvider>
                <CheckoutBridge>{children}</CheckoutBridge>
              </DiscountProvider>
            </ApplicationProvider>
          </Authentication>
        </LanguageProvider>
      </ThemeProvider>
    </CityProvider>
  )
}

export default layout
