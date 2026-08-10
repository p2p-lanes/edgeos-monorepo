"use client"

import "@/i18n/config"
import { useSearchParams } from "next/navigation"
import type { ReactNode } from "react"
import HelpButton from "@/components/HelpButton"
import { SidebarProvider } from "@/components/Sidebar/SidebarComponents"
import { TooltipProvider } from "@/components/ui/tooltip"
import useResolvedAttendees from "@/hooks/useResolvedAttendees"
import ApplicationProvider, {
  useApplication,
} from "@/providers/applicationProvider"
import CityProvider from "@/providers/cityProvider"
import DiscountProvider from "@/providers/discountProvider"
import { LanguageProvider } from "@/providers/languageProvider"
import PassesProvider from "@/providers/passesProvider"
import ThemeProvider from "@/providers/themeProvider"

/**
 * Bridges `useResolvedAttendees` (which branches on sale_type) into the
 * `PassesProvider` `attendees` prop. Must live inside ApplicationProvider
 * and CityProvider so the hook can read both.
 *
 * `?flow=` names which door into the gathering the screen is about. The
 * attendee query is popup-scoped, so without it someone holding two
 * applications sees both sets of passes at once with nothing saying which
 * is which (sdd/sales-flows-rediseno). Absent, `getRelevantApplication`
 * answers only when there is a single application — the common case, left
 * exactly as it was.
 */
const PassesBridge = ({ children }: { children: ReactNode }) => {
  const searchParams = useSearchParams()
  const { getRelevantApplication } = useApplication()
  const flowId = searchParams.get("flow")
  const application = getRelevantApplication(flowId)
  const attendees = useResolvedAttendees(application?.id ?? null)
  return <PassesProvider attendees={attendees}>{children}</PassesProvider>
}

const Providers = ({ children }: { children: ReactNode }) => {
  return (
    <CityProvider>
      <ThemeProvider>
        <LanguageProvider>
          <TooltipProvider>
            <ApplicationProvider>
              <DiscountProvider>
                <PassesBridge>
                  <SidebarProvider>
                    {children}
                    <HelpButton />
                  </SidebarProvider>
                </PassesBridge>
              </DiscountProvider>
            </ApplicationProvider>
          </TooltipProvider>
        </LanguageProvider>
      </ThemeProvider>
    </CityProvider>
  )
}
export default Providers
