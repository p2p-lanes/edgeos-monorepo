"use client"

import { ShoppingCart } from "lucide-react"
import Link from "next/link"
import { useCart } from "@/hooks/useCartApi"
import { useCityProvider } from "@/providers/cityProvider"

const CartBadge = () => {
  const { getCity } = useCityProvider()
  const city = getCity()
  const cityId = city?.id ? String(city.id) : null
  const { data: cart } = useCart(cityId)

  const itemCount =
    (cart?.passes?.length ?? 0) +
    (cart?.housing ? 1 : 0) +
    (cart?.merch?.length ?? 0) +
    (cart?.patron ? 1 : 0)

  if (!itemCount || !city?.slug) return null

  return (
    <Link
      href={`/portal/${city.slug}/passes/buy`}
      className="relative flex items-center justify-center rounded-md p-1.5 text-nav-text-secondary transition-colors hover:text-nav-text"
    >
      <ShoppingCart className="h-5 w-5" />
      <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-medium text-white">
        {itemCount}
      </span>
    </Link>
  )
}

export default CartBadge
