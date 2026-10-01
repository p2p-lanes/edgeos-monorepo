import type { ProductsPass } from "@/types/Products"

/** Show the catalog price (not the MSRP) when a checkout discount is active. */
export function productComparePrice(product: ProductsPass): number | null {
  const catalogPrice = product.original_price
  if (catalogPrice != null && catalogPrice > product.price) {
    return catalogPrice
  }
  return product.compare_price ?? null
}
