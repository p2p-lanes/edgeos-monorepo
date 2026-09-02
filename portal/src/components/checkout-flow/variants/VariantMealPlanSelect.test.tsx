import { expect, it } from "vitest"
import type { ProductsPass } from "@/types/Products"
import { participantMealProducts } from "./VariantMealPlanSelect"

it("offers every meal-plan product without legacy classification", () => {
  const products = [
    { id: "weekly", category: "meal_plan" },
    { id: "vegan", category: "meal_plan" },
    { id: "shirt", category: "merch" },
  ] as ProductsPass[]

  expect(
    participantMealProducts(products).map((product) => product.id),
  ).toEqual(["weekly", "vegan"])
})
