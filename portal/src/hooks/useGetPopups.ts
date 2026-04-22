import { useQuery } from "@tanstack/react-query"
import { useParams, usePathname, useRouter } from "next/navigation"
import { useEffect } from "react"
import { type PopupPublic, PopupsService } from "@/client"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { queryKeys } from "@/lib/query-keys"

const getPopupStartTime = (popup: PopupPublic) => {
  if (!popup.start_date) return Number.POSITIVE_INFINITY

  const startTime = new Date(popup.start_date).getTime()
  return Number.isNaN(startTime) ? Number.POSITIVE_INFINITY : startTime
}

const sortPopupsByUpcomingDate = (popups: PopupPublic[]) => {
  return [...popups].sort((a, b) => {
    const dateDifference = getPopupStartTime(a) - getPopupStartTime(b)

    if (dateDifference !== 0) {
      return dateDifference
    }

    return a.name.localeCompare(b.name)
  })
}

/** Authenticated query — uses HumanTenantSession (RLS-scoped) on the backend. */
export function usePopupsQuery(enabled = true) {
  const isAuthenticated = useIsAuthenticated()
  return useQuery({
    queryKey: queryKeys.popups.portal(),
    queryFn: async () => {
      const result = await PopupsService.listPortalPopups()
      return sortPopupsByUpcomingDate(
        result.filter((popup) => popup.status === "active"),
      )
    },
    enabled: enabled && isAuthenticated,
  })
}

/** Public query — uses X-Tenant-Id header, no auth required. */
export function usePublicPopupsQuery(enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.popups.portal(), "public"],
    queryFn: async () => {
      const tenantId = localStorage.getItem("portal_tenant_id") ?? ""
      const result = await PopupsService.listPublicPopups({
        xTenantId: tenantId,
      })
      return sortPopupsByUpcomingDate(result)
    },
    enabled,
  })
}

export function usePopupsRedirect() {
  const { data: popups = [] } = usePopupsQuery()
  const router = useRouter()
  const { popupSlug } = useParams()
  const pathname = usePathname()

  useEffect(() => {
    if (popups.length === 0) return
    if (pathname === "/portal/poaps" || pathname === "/portal/profile") return

    const findCity = (slug?: string) =>
      popups.find((city) => (slug ? city.slug === slug : true))

    if (!popupSlug || !findCity(popupSlug as string)) {
      const selectedCity = findCity()
      if (selectedCity) router.push(`/portal/${selectedCity.slug}`)
    }
  }, [popups, popupSlug, pathname, router])
}

export default usePopupsQuery
