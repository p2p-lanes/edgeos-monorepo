"use client"

import { Calendar, Check, Home } from "lucide-react"
import Image from "next/image"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import {
  calculateNights,
  formatCheckoutDate,
  formatCurrency,
} from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"
import type { VariantProps } from "../DynamicProductStep"

function formatDateInput(date: Date): string {
  return date.toISOString().split("T")[0]
}

function parseDate(dateStr: string): Date {
  const ymd = dateStr.split("T")[0]
  return new Date(`${ymd}T00:00:00`)
}

/* ── Shared date picker section ───────────────────────────── */

function DatePickerSection({
  checkIn,
  checkOut,
  popupStart,
  popupEnd,
  nights,
  onCheckInChange,
  onCheckOutChange,
}: {
  checkIn: Date
  checkOut: Date
  popupStart: Date
  popupEnd: Date
  nights: number
  onCheckInChange: (date: Date) => void
  onCheckOutChange: (date: Date) => void
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 overflow-hidden">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-4 h-4 text-gray-500 shrink-0" />
        <span className="text-sm font-medium text-gray-900">
          {nights} night{nights !== 1 ? "s" : ""}:{" "}
          {formatCheckoutDate(formatDateInput(checkIn))} -{" "}
          {formatCheckoutDate(formatDateInput(checkOut))}
        </span>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <div className="flex-1 min-w-0">
          <label
            htmlFor="checkin-date"
            className="block text-xs text-gray-500 mb-1 sm:hidden"
          >
            Check-in
          </label>
          <input
            id="checkin-date"
            type="date"
            value={formatDateInput(checkIn)}
            min={formatDateInput(popupStart)}
            max={formatDateInput(checkOut)}
            onChange={(e) => onCheckInChange(parseDate(e.target.value))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <span className="hidden sm:block self-center text-gray-400">to</span>
        <div className="flex-1 min-w-0">
          <label
            htmlFor="checkout-date"
            className="block text-xs text-gray-500 mb-1 sm:hidden"
          >
            Check-out
          </label>
          <input
            id="checkout-date"
            type="date"
            value={formatDateInput(checkOut)}
            min={formatDateInput(checkIn)}
            max={formatDateInput(popupEnd)}
            onChange={(e) => onCheckOutChange(parseDate(e.target.value))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
    </div>
  )
}

/* ── Shared skip link ─────────────────────────────────────── */

function SkipLink({ onSkip }: { onSkip?: () => void }) {
  return (
    <div className="text-center py-2">
      <button
        type="button"
        onClick={onSkip}
        className="text-gray-500 hover:text-gray-700 underline text-sm transition-colors"
      >
        Skip this step
      </button>
    </div>
  )
}

/* ── Card props shared by both variants ───────────────────── */

interface CardListProps {
  products: ProductsPass[]
  nights: number
  selectedProductId: string | null
  onProductSelect: (productId: string) => void
  onSkip?: () => void
}

/* ── Variant: Compact (minimal horizontal rows) ───────────── */

function HousingCompact({
  products,
  nights,
  selectedProductId,
  onProductSelect,
  onSkip,
}: CardListProps) {
  return (
    <div className="space-y-2">
      {products.map((product) => {
        const isSelected = selectedProductId === product.id
        const totalPrice = product.price * nights
        const compareTotal = product.compare_price
          ? product.compare_price * nights
          : null

        return (
          <button
            key={product.id}
            type="button"
            onClick={() => onProductSelect(product.id)}
            className={cn(
              "w-full flex items-center gap-3 rounded-xl border border-l-4 px-3 py-3 text-left transition-all",
              isSelected
                ? "border-gray-200 border-l-blue-600 bg-blue-50/50"
                : "border-gray-200 border-l-transparent hover:border-gray-300",
            )}
          >
            <div
              className={cn(
                "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                isSelected
                  ? "bg-blue-600 border-blue-600"
                  : "bg-white border-gray-300",
              )}
            >
              {isSelected && <Check className="w-3 h-3 text-white" />}
            </div>

            <div className="w-14 h-14 rounded-lg overflow-hidden bg-gray-100 shrink-0 relative">
              {product.image_url ? (
                <Image
                  src={product.image_url}
                  alt={product.name}
                  fill
                  className="object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Home className="w-5 h-5 text-gray-300" />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-gray-900 truncate">
                {product.name}
              </p>
              <p className="text-xs text-gray-500">
                {formatCurrency(product.price)}/night
              </p>
            </div>

            <div className="text-right shrink-0">
              {compareTotal && compareTotal > totalPrice && (
                <p className="text-xs text-gray-400 line-through">
                  {formatCurrency(compareTotal)}
                </p>
              )}
              <p
                className={cn(
                  "font-bold text-sm",
                  isSelected ? "text-blue-600" : "text-gray-900",
                )}
              >
                {formatCurrency(totalPrice)}
              </p>
              <p className="text-xs text-gray-500">total</p>
            </div>
          </button>
        )
      })}
      <SkipLink onSkip={onSkip} />
    </div>
  )
}

/* ── Variant: Grid (2-column gallery cards) ───────────────── */

function HousingGrid({
  products,
  nights,
  selectedProductId,
  onProductSelect,
  onSkip,
}: CardListProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {products.map((product) => {
          const isSelected = selectedProductId === product.id
          const totalPrice = product.price * nights
          const compareTotal = product.compare_price
            ? product.compare_price * nights
            : null

          return (
            <button
              key={product.id}
              type="button"
              onClick={() => onProductSelect(product.id)}
              className={cn(
                "relative flex flex-col rounded-2xl border overflow-hidden text-left transition-all",
                isSelected
                  ? "border-blue-600 ring-2 ring-blue-600/20"
                  : "border-gray-200 hover:border-gray-300",
              )}
            >
              {product.image_url ? (
                <div className="relative w-full aspect-[4/3] bg-gray-100">
                  <Image
                    src={product.image_url}
                    alt={product.name}
                    fill
                    className="object-cover"
                  />
                </div>
              ) : (
                <div className="w-full aspect-[4/3] bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                  <Home className="w-8 h-8 text-gray-300" />
                </div>
              )}

              {isSelected && (
                <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center">
                  <Check className="w-3.5 h-3.5 text-white" />
                </div>
              )}

              <div className="p-3">
                <p className="font-semibold text-gray-900 text-sm leading-tight">
                  {product.name}
                </p>
                {product.description && (
                  <p className="text-xs text-gray-500 line-clamp-2 mt-1">
                    {product.description}
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  {formatCurrency(product.price)}/night
                </p>
                <div className="flex items-center justify-between mt-2">
                  {compareTotal && compareTotal > totalPrice ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-400 line-through">
                        {formatCurrency(compareTotal)}
                      </span>
                      <span className="font-bold text-green-600 text-sm">
                        {formatCurrency(totalPrice)}
                      </span>
                    </div>
                  ) : (
                    <span
                      className={cn(
                        "font-bold text-sm",
                        isSelected ? "text-blue-600" : "text-gray-900",
                      )}
                    >
                      {formatCurrency(totalPrice)}
                    </span>
                  )}
                  <span
                    className={cn(
                      "text-xs px-2 py-0.5 rounded-full font-medium",
                      isSelected
                        ? "bg-blue-100 text-blue-700"
                        : "bg-gray-100 text-gray-500",
                    )}
                  >
                    {isSelected ? "Selected" : "Select"}
                  </span>
                </div>
              </div>
            </button>
          )
        })}
      </div>
      <SkipLink onSkip={onSkip} />
    </div>
  )
}

/* ── Main export ──────────────────────────────────────────── */

export default function VariantHousingDate({
  products,
  onSkip,
  templateConfig,
}: VariantProps) {
  const { cart, selectHousing, clearHousing } = useCheckout()
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

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Home className="w-12 h-12 text-gray-300 mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          No Housing Available
        </h3>
        <p className="text-gray-500 max-w-md mb-6">
          Housing options are not currently available for this event. You can
          continue to the next step.
        </p>
        <Button variant="outline" onClick={handleSkip}>
          Continue without housing
        </Button>
      </div>
    )
  }

  const variant = (templateConfig?.variant as string) || "compact"

  const cardProps: CardListProps = {
    products,
    nights,
    selectedProductId,
    onProductSelect: handleProductSelect,
    onSkip: handleSkip,
  }

  return (
    <div className="space-y-6">
      <DatePickerSection
        checkIn={checkIn}
        checkOut={checkOut}
        popupStart={popupStart}
        popupEnd={popupEnd}
        nights={nights}
        onCheckInChange={setCheckIn}
        onCheckOutChange={setCheckOut}
      />
      {variant === "grid" ? (
        <HousingGrid {...cardProps} />
      ) : (
        <HousingCompact {...cardProps} />
      )}
    </div>
  )
}
