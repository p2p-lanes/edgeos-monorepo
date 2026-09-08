import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useRequireDoor } from "./useRequireDoor"

const state = vi.hoisted(() => ({
  isNamed: false,
  loading: false,
  replace: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: state.replace }),
}))
vi.mock("./useRouteSalesFlow", () => ({
  useRouteSalesFlow: () => ({ isNamed: state.isNamed }),
}))
vi.mock("./useGatheringDoors", () => ({
  useGatheringDoors: () => ({
    doors: [{ flowId: "a" }, { flowId: "b" }],
    isLoading: state.loading,
  }),
}))

describe("useRequireDoor", () => {
  beforeEach(() => {
    state.isNamed = false
    state.loading = false
    state.replace.mockClear()
  })
  it("does not gate an explicitly named Shop flow on gathering doors", () => {
    state.isNamed = true
    state.loading = true
    const { result } = renderHook(() => useRequireDoor("popup", "festival"))
    expect(result.current).toBe(false)
    expect(state.replace).not.toHaveBeenCalled()
  })
  it("still requires a choice when multiple doors exist and none is named", () => {
    const { result } = renderHook(() => useRequireDoor("popup", "festival"))
    expect(result.current).toBe(true)
    expect(state.replace).toHaveBeenCalledWith("/portal/festival")
  })
})
