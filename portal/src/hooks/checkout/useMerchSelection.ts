import { useCallback, useState } from "react"
import type { SelectedMerchItem } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"

export function useMerchSelection(merchProducts: ProductsPass[]) {
  const [merch, setMerch] = useState<SelectedMerchItem[]>([])

  const updateMerchQuantity = useCallback(
    (productId: string, quantity: number) => {
      const product = merchProducts.find((p) => p.id === productId)
      if (!product) return

      if (quantity <= 0) {
        setMerch((prev) => prev.filter((m) => m.productId !== productId))
      } else {
        setMerch((prev) => {
          const existing = prev.find((m) => m.productId === productId)
          if (existing) {
            return prev.map((m) =>
              m.productId === productId
                ? { ...m, quantity, totalPrice: product.price * quantity }
                : m,
            )
          }
          return [
            ...prev,
            {
              productId,
              product,
              quantity,
              unitPrice: product.price,
              totalPrice: product.price * quantity,
            },
          ]
        })
      }
    },
    [merchProducts],
  )

  return { merch, setMerch, updateMerchQuantity }
}
