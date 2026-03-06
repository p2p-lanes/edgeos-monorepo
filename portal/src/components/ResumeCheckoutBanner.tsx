"use client"

import { ShoppingCart, X } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { useCart } from "@/hooks/useCartApi"
import { useCityProvider } from "@/providers/cityProvider"

const DISMISS_KEY = "resume-checkout-dismissed"

const ResumeCheckoutBanner = () => {
  const { getCity } = useCityProvider()
  const city = getCity()
  const cityId = city?.id ? String(city.id) : null
  const { data: cart } = useCart(cityId)

  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false
    return sessionStorage.getItem(DISMISS_KEY) === "true"
  })

  const itemCount =
    (cart?.passes?.length ?? 0) +
    (cart?.housing ? 1 : 0) +
    (cart?.merch?.length ?? 0) +
    (cart?.patron ? 1 : 0)

  if (!itemCount || !city?.slug || dismissed) return null

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "true")
    setDismissed(true)
  }

  return (
    <div className="mx-4 mt-4 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
      <ShoppingCart className="h-5 w-5 shrink-0 text-blue-600" />
      <p className="flex-1 text-sm text-blue-800">
        You have {itemCount} item{itemCount > 1 ? "s" : ""} in your cart.{" "}
        <Link
          href={`/portal/${city.slug}/passes/buy`}
          className="font-medium underline hover:text-blue-900"
        >
          Resume checkout
        </Link>
      </p>
      <button
        type="button"
        onClick={handleDismiss}
        className="shrink-0 rounded p-1 text-blue-400 transition-colors hover:text-blue-600"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

export default ResumeCheckoutBanner
