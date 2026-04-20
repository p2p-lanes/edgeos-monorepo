import { useCallback, useState } from "react"
import type { SelectedHousingItem } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"

function computeNights(checkIn: string, checkOut: string): number {
  const start = new Date(checkIn)
  const end = new Date(checkOut)
  return Math.max(
    1,
    Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
  )
}

function computeBasePrice(
  product: ProductsPass,
  nights: number,
  pricePerDay: boolean,
): number {
  return pricePerDay ? product.price * nights : product.price
}

function clampQuantity(product: ProductsPass, quantity: number): number {
  const max = product.max_quantity
  if (max == null) return Math.max(0, quantity)
  return Math.max(0, Math.min(quantity, max))
}

export function useHousingSelection(
  housingProducts: ProductsPass[],
  pricePerDay = true,
) {
  const [housing, setHousing] = useState<SelectedHousingItem | null>(null)

  const selectHousing = useCallback(
    (productId: string, checkIn: string, checkOut: string) => {
      const product = housingProducts.find((p) => p.id === productId)
      if (!product) return

      const nights = computeNights(checkIn, checkOut)
      const basePrice = computeBasePrice(product, nights, pricePerDay)

      setHousing((prev) => {
        // Preserve the current quantity when reselecting the same product
        // (e.g. when the user only changes dates).
        const prevQuantity =
          prev && prev.productId === productId ? prev.quantity : 1
        const quantity = clampQuantity(product, prevQuantity || 1) || 1
        return {
          productId,
          product,
          checkIn,
          checkOut,
          nights,
          pricePerNight: product.price,
          totalPrice: basePrice * quantity,
          pricePerDay,
          quantity,
        }
      })
    },
    [housingProducts, pricePerDay],
  )

  const updateHousingQuantity = useCallback((quantity: number) => {
    setHousing((prev) => {
      if (!prev) return prev
      const clamped = clampQuantity(prev.product, quantity)
      if (clamped <= 0) return null
      const basePrice = computeBasePrice(
        prev.product,
        prev.nights,
        prev.pricePerDay,
      )
      return {
        ...prev,
        quantity: clamped,
        totalPrice: basePrice * clamped,
      }
    })
  }, [])

  const clearHousing = useCallback(() => {
    setHousing(null)
  }, [])

  return {
    housing,
    setHousing,
    selectHousing,
    updateHousingQuantity,
    clearHousing,
  }
}
