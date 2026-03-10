import { useCallback, useState } from "react"
import type { SelectedHousingItem } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"

export function useHousingSelection(housingProducts: ProductsPass[]) {
  const [housing, setHousing] = useState<SelectedHousingItem | null>(null)

  const selectHousing = useCallback(
    (productId: string, checkIn: string, checkOut: string) => {
      const product = housingProducts.find((p) => p.id === productId)
      if (!product) return

      const start = new Date(checkIn)
      const end = new Date(checkOut)
      const nights = Math.max(
        1,
        Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
      )

      setHousing({
        productId,
        product,
        checkIn,
        checkOut,
        nights,
        pricePerNight: product.price,
        totalPrice: product.price * nights,
      })
    },
    [housingProducts],
  )

  const clearHousing = useCallback(() => {
    setHousing(null)
  }, [])

  return { housing, setHousing, selectHousing, clearHousing }
}
