"use client"

import { Calendar, Check, Home } from "lucide-react"
import Image from "next/image"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import ExpandableDescription from "@/components/ui/ExpandableDescription"
import QuantitySelector, {
  supportsQuantitySelector,
} from "@/components/ui/QuantitySelector"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import {
  calculateNights,
  formatCheckoutDate,
  formatCurrency,
} from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"

interface HousingStepProps {
  onSkip?: () => void
}

function formatDateInput(date: Date): string {
  return date.toISOString().split("T")[0]
}

function parseDate(dateStr: string): Date {
  const ymd = dateStr.split("T")[0]
  return new Date(`${ymd}T00:00:00`)
}

export default function HousingStep({ onSkip }: HousingStepProps) {
  const {
    housingProducts,
    cart,
    selectHousing,
    updateHousingQuantity,
    clearHousing,
  } = useCheckout()
  const { getCity } = useCityProvider()
  const city = getCity()

  const popupStart = useMemo(() => {
    if (city?.start_date) return parseDate(city.start_date)
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  }, [city?.start_date])

  const popupEnd = useMemo(() => {
    if (city?.end_date) return parseDate(city.end_date)
    return new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
  }, [city?.end_date])

  const [checkIn, setCheckIn] = useState<Date>(
    cart.housing?.checkIn ? new Date(cart.housing.checkIn) : popupStart,
  )
  const [checkOut, setCheckOut] = useState<Date>(
    cart.housing?.checkOut ? new Date(cart.housing.checkOut) : popupEnd,
  )
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    cart.housing?.productId || null,
  )

  const nights = calculateNights(
    formatDateInput(checkIn),
    formatDateInput(checkOut),
  )

  useEffect(() => {
    if (selectedProductId) {
      selectHousing(
        selectedProductId,
        formatDateInput(checkIn),
        formatDateInput(checkOut),
      )
    }
  }, [selectedProductId, checkIn, checkOut, selectHousing])

  const handleProductSelect = (productId: string) => {
    if (selectedProductId === productId) {
      setSelectedProductId(null)
      clearHousing()
    } else {
      setSelectedProductId(productId)
    }
  }

  const handleSkip = () => {
    setSelectedProductId(null)
    clearHousing()
    onSkip?.()
  }

  if (housingProducts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Home className="w-12 h-12 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">
          No Housing Available
        </h3>
        <p className="text-muted-foreground max-w-md mb-6">
          Housing options are not currently available for this event. You can
          continue to the next step.
        </p>
        <Button variant="outline" onClick={handleSkip}>
          Continue without housing
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Date Selection */}
      <div className="bg-card rounded-2xl shadow-sm border border-border p-4 overflow-hidden">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium text-foreground">
            {nights} night{nights !== 1 ? "s" : ""}:{" "}
            {formatCheckoutDate(formatDateInput(checkIn))} -{" "}
            {formatCheckoutDate(formatDateInput(checkOut))}
          </span>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <div className="flex-1 min-w-0">
            <label
              htmlFor="checkin-date"
              className="block text-xs text-muted-foreground mb-1 sm:hidden"
            >
              Check-in
            </label>
            <input
              id="checkin-date"
              type="date"
              value={formatDateInput(checkIn)}
              min={formatDateInput(popupStart)}
              max={formatDateInput(checkOut)}
              onChange={(e) => setCheckIn(parseDate(e.target.value))}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <span className="hidden sm:block self-center text-muted-foreground">to</span>
          <div className="flex-1 min-w-0">
            <label
              htmlFor="checkout-date"
              className="block text-xs text-muted-foreground mb-1 sm:hidden"
            >
              Check-out
            </label>
            <input
              id="checkout-date"
              type="date"
              value={formatDateInput(checkOut)}
              min={formatDateInput(checkIn)}
              max={formatDateInput(popupEnd)}
              onChange={(e) => setCheckOut(parseDate(e.target.value))}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
      </div>

      {/* Property Cards */}
      <div className="space-y-4">
        {housingProducts.map((product) => {
          const isSelected = selectedProductId === product.id
          return (
            <PropertyCard
              key={product.id}
              product={product}
              nights={nights}
              isSelected={isSelected}
              quantity={
                isSelected && cart.housing ? (cart.housing.quantity ?? 1) : 1
              }
              onSelect={() => handleProductSelect(product.id)}
              onQuantityChange={
                isSelected
                  ? (qty) => {
                      if (qty <= 0) {
                        setSelectedProductId(null)
                        clearHousing()
                        return
                      }
                      updateHousingQuantity(qty)
                    }
                  : undefined
              }
            />
          )
        })}
      </div>
    </div>
  )
}

interface PropertyCardProps {
  product: ProductsPass
  nights: number
  isSelected: boolean
  quantity: number
  onSelect: () => void
  onQuantityChange?: (qty: number) => void
}

function PropertyCard({
  product,
  nights,
  isSelected,
  quantity,
  onSelect,
  onQuantityChange,
}: PropertyCardProps) {
  const showStepper =
    isSelected &&
    !!onQuantityChange &&
    supportsQuantitySelector(product.max_quantity)
  const maxQty = product.max_quantity ?? Number.POSITIVE_INFINITY
  const basePrice = product.price * nights
  const totalPrice = basePrice * quantity
  const compareBase = product.compare_price
    ? product.compare_price * nights
    : null
  const compareTotal = compareBase != null ? compareBase * quantity : null

  return (
    <div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden">
      <div className="relative h-32 sm:h-40 bg-gradient-to-br from-muted to-muted/60">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            className="object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Home className="w-12 h-12 text-muted-foreground/50" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4 text-white">
          <h3 className="font-bold text-base sm:text-lg">{product.name}</h3>
        </div>
      </div>
      <div className="p-3 sm:p-4">
        {product.description && (
          <ExpandableDescription
            text={product.description}
            clamp={2}
            className="text-xs sm:text-sm text-muted-foreground mb-3"
          />
        )}
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            "w-full flex items-center justify-between p-3 sm:p-4 rounded-xl border-2 transition-all",
            isSelected
              ? "border-primary bg-primary/10"
              : "border-border bg-muted hover:border-muted-foreground/30",
          )}
        >
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div
              className={cn(
                "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0",
                isSelected ? "border-primary bg-primary" : "border-muted-foreground/40",
              )}
            >
              {isSelected && <Check className="w-3 h-3 text-white" />}
            </div>
            <div className="text-left min-w-0">
              <p className="font-medium text-foreground text-sm sm:text-base truncate">
                {product.name}
              </p>
              <p className="text-xs sm:text-sm text-muted-foreground">
                {formatCurrency(product.price)}/night
              </p>
            </div>
          </div>
          <div className="text-right shrink-0 ml-2">
            {compareTotal && compareTotal > totalPrice && (
              <p className="text-xs text-muted-foreground line-through">
                {formatCurrency(compareTotal)}
              </p>
            )}
            <p
              className={cn(
                "font-bold text-base sm:text-lg",
                isSelected ? "text-primary" : "text-foreground",
              )}
            >
              {formatCurrency(totalPrice)}
            </p>
            <p className="text-xs text-muted-foreground">
              {quantity > 1 ? `${quantity} × total` : "total"}
            </p>
          </div>
        </button>
        {showStepper && onQuantityChange && (
          <div className="mt-3 flex items-center justify-between px-3 sm:px-4">
            <span className="text-xs text-muted-foreground">Units</span>
            <QuantitySelector
              size="md"
              value={quantity}
              min={0}
              max={maxQty}
              onIncrement={() => onQuantityChange(quantity + 1)}
              onDecrement={() => onQuantityChange(quantity - 1)}
              onAdd={() => onQuantityChange(1)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
