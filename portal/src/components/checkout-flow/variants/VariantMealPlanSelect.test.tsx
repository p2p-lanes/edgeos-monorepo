import { expect, it } from "vitest"
import type { ProductsPass } from "@/types/Products"
import { participantMealProducts } from "./VariantMealPlanSelect"

it("offers only explicitly participant meal products", () => {
  const products = (
    ["participant", null, undefined, "access", "order"] as const
  ).map(
    (fulfillment_type) =>
      ({
        id: String(fulfillment_type),
        category: "meal_plan",
        fulfillment_type,
      }) as ProductsPass,
  )
  products.push({ id: "omitted", category: "meal_plan" } as ProductsPass)

  expect(
    participantMealProducts(products).map((product) => product.id),
  ).toEqual(["participant"])
})
