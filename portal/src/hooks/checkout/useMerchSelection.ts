import { useCallback, useState } from "react"
import type { SelectedMerchItem } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"

export function useMerchSelection(allActiveProducts: ProductsPass[]) {
  const [merch, setMerch] = useState<SelectedMerchItem[]>([])

  const updateMerchQuantity = useCallback(
    (productId: string, quantity: number) => {
      const product = allActiveProducts.find((p) => p.id === productId)
      if (!product) return

      const clamped =
        product.max_quantity == null
          ? Math.max(0, quantity)
          : Math.max(0, Math.min(quantity, product.max_quantity))

      if (clamped <= 0) {
        setMerch((prev) => prev.filter((m) => m.productId !== productId))
      } else {
        setMerch((prev) => {
          const existing = prev.find((m) => m.productId === productId)
          if (existing) {
            return prev.map((m) =>
              m.productId === productId
                ? {
                    ...m,
                    quantity: clamped,
                    totalPrice: product.price * clamped,
                  }
                : m,
            )
          }
          return [
            ...prev,
            {
              productId,
              product,
              quantity: clamped,
              unitPrice: product.price,
              totalPrice: product.price * clamped,
            },
          ]
        })
      }
    },
    [allActiveProducts],
  )

  return { merch, setMerch, updateMerchQuantity }
}
