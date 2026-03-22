import { useMemo } from "react"
import type { ProductsPass } from "@/types/Products"

export function useProductCategories(products: ProductsPass[]) {
  const passProducts = useMemo(
    () => products.filter((p) => p.category.toLowerCase() === "ticket" && p.is_active),
    [products],
  )

  const housingProducts = useMemo(
    () => products.filter((p) => p.category.toLowerCase() === "housing" && p.is_active),
    [products],
  )

  const merchProducts = useMemo(
    () => products.filter((p) => p.category.toLowerCase() === "merch" && p.is_active),
    [products],
  )

  const patronProducts = useMemo(
    () => products.filter((p) => p.category.toLowerCase() === "patreon" && p.is_active),
    [products],
  )

  return { passProducts, housingProducts, merchProducts, patronProducts }
}
