"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { HumansService, type PublicProfileSettings } from "@/client"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { queryKeys } from "@/lib/query-keys"

/** The caller's public profile share link and its visibility setting. */
const usePublicProfileSettings = () => {
  const isAuthenticated = useIsAuthenticated()
  const queryClient = useQueryClient()

  const query = useQuery<PublicProfileSettings>({
    queryKey: queryKeys.profile.publicProfile,
    queryFn: () => HumansService.getMyPublicProfile(),
    enabled: isAuthenticated,
  })

  const store = (settings: PublicProfileSettings) =>
    queryClient.setQueryData(queryKeys.profile.publicProfile, settings)

  const setEnabled = useMutation({
    mutationFn: (enabled: boolean) =>
      HumansService.updateMyPublicProfile({ requestBody: { enabled } }),
    onSuccess: store,
  })

  return {
    settings: query.data ?? null,
    isLoading: query.isLoading,
    setEnabled,
  }
}

export default usePublicProfileSettings
