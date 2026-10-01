import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import DiscountProvider, { useDiscount } from "./discountProvider"

const groups = [{ id: "group-1", discount_percentage: 10 }]
let currentApplication: {
  group_id: string | null
  scholarship_status?: string | null
  discount_percentage?: number | null
} = { group_id: "group-1" }
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("./cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => ({ id: "popup-1" }) }),
}))
vi.mock("./applicationProvider", () => ({
  useApplication: () => ({
    getRelevantApplication: () => currentApplication,
  }),
}))
vi.mock("@/components/Sidebar/hooks/useGetGroups", () => ({
  useGroupsQuery: () => ({ data: groups }),
}))

afterEach(cleanup)
beforeEach(() => {
  currentApplication = { group_id: "group-1" }
})

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

it("uses an approved scholarship instead of stacking it with a group discount", () => {
  currentApplication = {
    group_id: "group-1",
    scholarship_status: "approved",
    discount_percentage: 30,
  }
  function Consumer() {
    const { discountApplied } = useDiscount()
    return <output>{JSON.stringify(discountApplied)}</output>
  }
  const { rerender } = render(
    <DiscountProvider>
      <Consumer />
    </DiscountProvider>,
  )
  expect(
    JSON.parse(screen.getByRole("status").textContent ?? "{}"),
  ).toMatchObject({
    discount_value: 30,
    discount_code: null,
  })

  // An award from a previous application must not follow the next flow.
  currentApplication = { group_id: "group-1" }
  rerender(
    <DiscountProvider>
      <Consumer />
    </DiscountProvider>,
  )
  expect(
    JSON.parse(screen.getByRole("status").textContent ?? "{}"),
  ).toMatchObject({
    discount_value: 10,
  })
})

it("chooses the best discount without stacking a coupon and scholarship", () => {
  currentApplication = {
    group_id: "group-1",
    scholarship_status: "approved",
    discount_percentage: 30,
  }
  function Consumer() {
    const { discountApplied, setDiscount, resetDiscount } = useDiscount()
    return (
      <>
        <output>{JSON.stringify(discountApplied)}</output>
        <button
          type="button"
          onClick={() =>
            setDiscount({
              discount_value: 40,
              discount_type: "percentage",
              discount_code: "COUPON",
              city_id: "popup-1",
            })
          }
        >
          Apply coupon
        </button>
        <button type="button" onClick={resetDiscount}>
          Clear coupon
        </button>
      </>
    )
  }
  render(
    <DiscountProvider>
      <Consumer />
    </DiscountProvider>,
  )
  fireEvent.click(screen.getByRole("button", { name: "Apply coupon" }))
  expect(
    JSON.parse(screen.getByRole("status").textContent ?? "{}"),
  ).toMatchObject({
    discount_value: 40,
    discount_code: "COUPON",
  })
  fireEvent.click(screen.getByRole("button", { name: "Clear coupon" }))
  expect(
    JSON.parse(screen.getByRole("status").textContent ?? "{}"),
  ).toMatchObject({
    discount_value: 30,
    discount_code: null,
  })
})

it("does not discount pending or rejected scholarships", () => {
  currentApplication = {
    group_id: null,
    scholarship_status: "pending",
    discount_percentage: 30,
  }
  function Consumer() {
    return <output>{useDiscount().discountApplied.discount_value}</output>
  }
  const { rerender } = render(
    <DiscountProvider>
      <Consumer />
    </DiscountProvider>,
  )
  expect(screen.getByRole("status").textContent).toBe("0")
  currentApplication = { ...currentApplication, scholarship_status: "rejected" }
  rerender(
    <DiscountProvider>
      <Consumer />
    </DiscountProvider>,
  )
  expect(screen.getByRole("status").textContent).toBe("0")
})
