"use client"

import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import type { PopupPublic } from "@/client"
import { visiblePortalFallback } from "@/hooks/portalPopupList"
import { usePopupsQuery, usePublicPopupsQuery } from "@/hooks/useGetPopups"
import { setActiveCurrency } from "@/types/checkout"

interface CityContext_interface {
  getCity: () => PopupPublic | null
  getPopups: () => PopupPublic[]
  setCityPreselected: (cityId: string) => void
  popupsLoaded: boolean
}

export const CityContext = createContext<CityContext_interface | null>(null)

const CityProvider = ({
  children,
  public: isPublic = false,
}: {
  children: ReactNode
  public?: boolean
}) => {
  const authenticatedQuery = usePopupsQuery(!isPublic)
  const publicQuery = usePublicPopupsQuery(isPublic)
  const { data: popups = [], isFetched } = isPublic
    ? publicQuery
    : authenticatedQuery
  const [cityPreselected, setCityPreselected] = useState<string | null>(null)
  const [lastValidCity, setLastValidCity] = useState<PopupPublic | null>(null)
  const params = useParams()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const rawSlug = params.popupSlug
  const currentSlug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug

  const popupsLoaded = isFetched

  const getValidCity = useCallback((): PopupPublic | null => {
    return popups.find((popup) => popup.slug === currentSlug) ?? null
  }, [popups, currentSlug])

  const cityFromUrl = getValidCity()
  const fallbackCity = visiblePortalFallback(popups, lastValidCity)

  useEffect(() => {
    if (cityFromUrl) {
      setLastValidCity(cityFromUrl)
    }
  }, [cityFromUrl])

  useEffect(() => {
    if (!popupsLoaded) return
    if (!currentSlug) return
    if (cityFromUrl) return
    const fallback = visiblePortalFallback(popups, lastValidCity)
    if (!fallback?.slug) {
      router.replace("/portal")
      return
    }
    const segments = pathname.split("/")
    const slugIndex = segments.indexOf(currentSlug)
    if (slugIndex === -1) return
    segments[slugIndex] = fallback.slug
    const query = searchParams.toString()
    router.replace(`${segments.join("/")}${query ? `?${query}` : ""}`)
  }, [
    popupsLoaded,
    currentSlug,
    cityFromUrl,
    lastValidCity,
    popups,
    pathname,
    router,
    searchParams,
  ])

  const activePopup = cityFromUrl ?? fallbackCity
  setActiveCurrency(activePopup?.currency ?? "USD")

  const getCity = useCallback((): PopupPublic | null => {
    const city = getValidCity()
    if (cityPreselected) {
      const selectedCity = popups.find((popup) => popup.id === cityPreselected)
      if (selectedCity) return selectedCity
    } else if (!city) {
      return visiblePortalFallback(popups, lastValidCity)
    }
    return city ?? null
  }, [getValidCity, cityPreselected, popups, lastValidCity])

  const getPopups = useCallback((): PopupPublic[] => {
    return popups
  }, [popups])

  const contextValue = useMemo(
    () => ({ getCity, getPopups, setCityPreselected, popupsLoaded }),
    [getCity, getPopups, popupsLoaded],
  )

  return (
    <CityContext.Provider value={contextValue}>{children}</CityContext.Provider>
  )
}

export const useCityProvider = (): CityContext_interface => {
  const context = useContext(CityContext)
  if (context === null) {
    throw new Error("useCityProvider must be used within a CityProvider")
  }
  return context
}

export default CityProvider
