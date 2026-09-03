"use client"

import { Loader } from "@/components/ui/Loader"
import { useCityProvider } from "@/providers/cityProvider"
import { ShopContent } from "./components/ShopContent"

export default function ShopPage() {
  const { getCity } = useCityProvider()
  const city = getCity()

  if (!city) return <Loader />

  return <ShopContent popupId={String(city.id)} popupSlug={city.slug} />
}
