"use client"

import { useQueryClient } from "@tanstack/react-query"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
} from "react"
import type {
  ApplicationPublic,
  ApplicationsGetMyParticipationResponse,
} from "@/client"
import { useApplicationsQuery } from "@/hooks/useGetApplications"
import { useParticipationQuery } from "@/hooks/useParticipationQuery"
import { queryKeys } from "@/lib/query-keys"
import type { AttendeePassState } from "@/types/Attendee"
import { useCityProvider } from "./cityProvider"

interface ApplicationContextProps {
  applications: ApplicationPublic[] | null
  participation: ApplicationsGetMyParticipationResponse | null
  /**
   * The application on screen.
   *
   * `flowId` names which door into the gathering is being looked at. A
   * person can hold more than one — accepted as a volunteer and applying
   * for general entry are two applications with two sets of attendees and
   * two balances (sdd/sales-flows-rediseno). Omitting it is only correct
   * when the gathering has a single door.
   */
  getRelevantApplication: (flowId?: string | null) => ApplicationPublic | null
  getApplicationsForPopup: () => ApplicationPublic[]
  getAttendees: (flowId?: string | null) => AttendeePassState[]
  updateApplication: (application: ApplicationPublic) => void
}

export const ApplicationContext = createContext<ApplicationContextProps | null>(
  null,
)

const ApplicationProvider = ({ children }: { children: ReactNode }) => {
  const { data: applications = null } = useApplicationsQuery()
  const { getCity } = useCityProvider()
  const queryClient = useQueryClient()
  const city = getCity()
  const { data: participation = null } = useParticipationQuery(
    city?.id ? String(city.id) : null,
  )

  const updateApplication = useCallback(
    (application: ApplicationPublic): void => {
      queryClient.setQueryData<ApplicationPublic[]>(
        queryKeys.applications.mine(),
        (old) => {
          if (!old) return old
          const filtered = old.filter((ap) => ap.id !== application.id)
          const freshApplication = JSON.parse(JSON.stringify(application))
          return [...filtered, freshApplication]
        },
      )
    },
    [queryClient],
  )

  const getApplicationsForPopup = useCallback((): ApplicationPublic[] => {
    const city = getCity()
    if (!applications || !city?.id) return []
    return applications.filter(
      (app: ApplicationPublic) => app.popup_id === city.id,
    )
  }, [applications, getCity])

  const getRelevantApplication = useCallback(
    (flowId?: string | null): ApplicationPublic | null => {
      const mine = getApplicationsForPopup()
      if (mine.length === 0) return null

      // Named door wins. Returning null when it does not match is the
      // point: the caller asked about one door, and answering with another
      // one's application is how the wrong attendees, the wrong balance and
      // the wrong payment used to reach the screen.
      if (flowId) {
        return mine.find((app) => app.sales_flow_id === flowId) ?? null
      }

      // No door named. Only one relationship makes that unambiguous; more
      // than one and there is nothing here that can choose. This used to
      // take `.slice(-1)[0]` — the OLDEST, since the API orders by
      // created_at descending — and every screen below trusted it.
      return mine.length === 1 ? mine[0] : null
    },
    [getApplicationsForPopup],
  )

  const getAttendees = useCallback(
    (flowId?: string | null): AttendeePassState[] => {
      const application = getRelevantApplication(flowId)
      if (!application) return []
      return (application.attendees ?? []).map((att) => ({
        ...att,
        products: [],
      }))
    },
    [getRelevantApplication],
  )

  const contextValue = useMemo(
    () => ({
      applications,
      participation,
      getRelevantApplication,
      getApplicationsForPopup,
      getAttendees,
      updateApplication,
    }),
    [
      applications,
      participation,
      getRelevantApplication,
      getApplicationsForPopup,
      getAttendees,
      updateApplication,
    ],
  )

  return (
    <ApplicationContext.Provider value={contextValue}>
      {children}
    </ApplicationContext.Provider>
  )
}

export const useApplication = () => {
  const context = useContext(ApplicationContext)
  if (!context) {
    throw new Error("useApplication must be used within an ApplicationProvider")
  }
  return context
}

export default ApplicationProvider
