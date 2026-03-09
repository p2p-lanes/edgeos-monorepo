import { useCallback, useState } from "react"
import type { SelectedPatronItem } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"

export function usePatronSelection(patronProducts: ProductsPass[]) {
  const [patron, setPatron] = useState<SelectedPatronItem | null>(null)

  const setPatronAmount = useCallback(
    (productId: string, amount: number, isCustom = false) => {
      const product = patronProducts.find((p) => p.id === productId)
      if (!product) return

      setPatron({
        productId,
        product,
        amount,
        isCustomAmount: isCustom,
      })
    },
    [patronProducts],
  )

  const clearPatron = useCallback(() => {
    setPatron(null)
  }, [])

  return { patron, setPatron, setPatronAmount, clearPatron }
}
