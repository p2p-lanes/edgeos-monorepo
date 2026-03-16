import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ApplicationsService, HumansService } from "@/client"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { queryKeys } from "@/lib/query-keys"
import type { FormDataProps } from "../types"

interface ExtendedApplicationData extends Partial<FormDataProps> {
  red_flag?: boolean
}

interface UseApplicationDataProps {
  groupPopupCityId?: string
}

export const useApplicationData = ({
  groupPopupCityId,
}: UseApplicationDataProps) => {
  const queryClient = useQueryClient()
  const isAuthenticated = useIsAuthenticated()

  const {
    data: applicationData = null,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: [...queryKeys.applications.mine(), "checkout", groupPopupCityId],
    queryFn: async (): Promise<ExtendedApplicationData | null> => {
      const token = window?.localStorage?.getItem("token")
      if (!token) return null

      // Get current human info from API (email, name, etc.)
      const human = await HumansService.getCurrentHumanInfo()
      if (!human?.email) return null

      const baseData: ExtendedApplicationData = {
        email: human.email,
        first_name: human.first_name || "",
        last_name: human.last_name || "",
        telegram: human.telegram || "",
        gender: human.gender?.toLowerCase() || "",
        email_verified: true,
        local_resident: "",
        red_flag: human.red_flag || false,
      }

      // If we have a group, check for matching application to get app-specific data
      if (groupPopupCityId) {
        try {
          const result = await ApplicationsService.listMyApplications()
          const matchingApp = result.results.find(
            (app) => app.popup_id === groupPopupCityId,
          )

          if (matchingApp) {
            return {
              ...baseData,
              first_name:
                matchingApp.human?.first_name || human.first_name || "",
              last_name: matchingApp.human?.last_name || human.last_name || "",
              telegram: matchingApp.human?.telegram || human.telegram || "",
              gender: (
                matchingApp.human?.gender ||
                human.gender ||
                ""
              ).toLowerCase(),
              red_flag: matchingApp.red_flag || false,
            }
          }
        } catch {
          // If applications fetch fails, still return human data
        }
      }

      return baseData
    },
    enabled: isAuthenticated,
  })

  const refreshApplicationData = () => {
    queryClient.invalidateQueries({
      queryKey: [
        ...queryKeys.applications.mine(),
        "checkout",
        groupPopupCityId,
      ],
    })
  }

  return {
    isLoading,
    error: queryError?.message ?? null,
    applicationData,
    refreshApplicationData,
  }
}
