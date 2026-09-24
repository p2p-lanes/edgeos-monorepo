import { expect, it } from "vitest"
import type { ProductsPass } from "@/types/Products"
import { productComparePrice } from "./product-compare-price"

it("shows the catalog price rather than MSRP when scholarship reduces it", () => {
  const product = {
    price: 647.5,
    original_price: 925,
    compare_price: 1000,
  } as ProductsPass
  expect(productComparePrice(product)).toBe(925)
})

it("keeps the catalog comparison when no checkout discount applies", () => {
  const product = {
    price: 925,
    original_price: 925,
    compare_price: 1000,
  } as ProductsPass
  expect(productComparePrice(product)).toBe(1000)
})
