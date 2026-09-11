"use client"

import {
  hasCustomHome,
  PopupHomeFrame,
} from "@edgeos/shared-form-ui/popup-home"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import DefaultPopupHome from "@/components/Portal/DefaultPopupHome"
import { Loader } from "@/components/ui/Loader"
import { useCityProvider } from "@/providers/cityProvider"

export default function Home() {
  const { getCity, popupsLoaded } = useCityProvider()
  const city = getCity()
  const router = useRouter()
  const { i18n } = useTranslation()

  useEffect(() => {
    if (popupsLoaded && !city) router.replace("/portal")
  }, [city, popupsLoaded, router])

  if (!city) return popupsLoaded ? null : <Loader />
  if (!hasCustomHome(city)) return <DefaultPopupHome />

  return (
    <PopupHomeFrame
      // A popup switch must not momentarily display the previous popup's HTML.
      key={city.id}
      html={city.custom_home_html!}
      popup={city}
      locale={i18n.resolvedLanguage ?? city.default_language ?? "en"}
      title={city.name}
      className="block h-full min-h-[480px] w-full border-0 bg-white"
    />
  )
}
