"use client"

import { ShoppingCart } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useCart, useClearCart } from "@/hooks/useCartApi"
import { cn } from "@/lib/utils"
import { useCityProvider } from "@/providers/cityProvider"

const CartBadge = () => {
  const { t } = useTranslation()
  const { getCity } = useCityProvider()
  const city = getCity()
  const cityId = city?.id ? String(city.id) : null
  const { data: cart } = useCart(cityId)
  const { mutate: clearCart, isPending } = useClearCart(cityId)
  const [confirming, setConfirming] = useState(false)

  const passCount = cart?.passes?.length ?? 0
  const merchCount = cart?.merch?.length ?? 0
  const hasHousing = Boolean(cart?.housing)
  const hasPatron = Boolean(cart?.patron)
  const itemCount =
    passCount + merchCount + (hasHousing ? 1 : 0) + (hasPatron ? 1 : 0)

  if (!itemCount || !city?.slug) return null

  const lines = [
    passCount > 0 && t("cartBadge.passes", { count: passCount }),
    hasHousing && t("cartBadge.housing"),
    merchCount > 0 && t("cartBadge.merch", { count: merchCount }),
    hasPatron && t("cartBadge.patron"),
  ].filter(Boolean) as string[]

  return (
    <Popover onOpenChange={(open) => !open && setConfirming(false)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("cartBadge.aria_open")}
          className="relative flex items-center justify-center rounded-md p-1.5 text-nav-text-secondary transition-colors hover:text-nav-text"
        >
          <ShoppingCart className="h-5 w-5" />
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-medium text-white">
            {itemCount}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <p className="mb-2 text-sm font-medium text-foreground">
          {t("cartBadge.title")}
        </p>
        <ul className="mb-3 space-y-1 text-sm text-muted-foreground">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <Link
          href={`/portal/${city.slug}/passes/buy`}
          className={cn(buttonVariants({ size: "sm" }), "w-full")}
        >
          {t("cartBadge.go_to_checkout")}
        </Link>
        {confirming ? (
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="flex-1"
              onClick={() => setConfirming(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="flex-1"
              disabled={isPending}
              onClick={() => clearCart()}
            >
              {isPending
                ? t("cartBadge.clearing")
                : t("cartBadge.clear_confirm")}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mt-2 w-full text-destructive hover:text-destructive"
            onClick={() => setConfirming(true)}
          >
            {t("cartBadge.clear")}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

export default CartBadge
