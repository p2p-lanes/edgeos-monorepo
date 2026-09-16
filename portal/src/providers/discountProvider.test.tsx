import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import DiscountProvider, { useDiscount } from "./discountProvider"

const groups = [{ id: "group-1", discount_percentage: 10 }]
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("./cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => ({ id: "popup-1" }) }),
}))
vi.mock("./applicationProvider", () => ({
  useApplication: () => ({
    getRelevantApplication: () => ({ group_id: "group-1" }),
  }),
}))
vi.mock("@/components/Sidebar/hooks/useGetGroups", () => ({
  useGroupsQuery: () => ({ data: groups }),
}))

afterEach(cleanup)

it("keeps the group discount scoped to its popup instead of looping through resets", () => {
  let renders = 0
  function Consumer() {
    if (++renders > 10)
      throw new Error("Group discount is stuck in a reset loop")
    const { discountApplied } = useDiscount()
    return <output>{JSON.stringify(discountApplied)}</output>
  }
  render(
    <DiscountProvider>
      <Consumer />
    </DiscountProvider>,
  )
  expect(JSON.parse(screen.getByRole("status").textContent ?? "{}")).toEqual({
    discount_value: 10,
    discount_type: "percentage",
    discount_code: null,
    city_id: "popup-1",
  })
  expect(renders).toBeLessThan(5)
})
