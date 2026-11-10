import { useCityProvider } from "@/providers/cityProvider"

/**
 * True once the portal popup list has loaded and is empty. The portal then
 * drops the sidebar (there is nothing to navigate) and the header carries
 * the profile link instead.
 */
export function useHasNoPortalPopups(): boolean {
  const { getPopups, popupsLoaded } = useCityProvider()
  return popupsLoaded && getPopups().length === 0
}
