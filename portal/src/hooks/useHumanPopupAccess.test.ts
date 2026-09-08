import { beforeEach, expect, it, vi } from "vitest"
import { useHumanPopupAccess } from "./useHumanPopupAccess"

const query = vi.hoisted(() => ({
  data: undefined as unknown,
  isError: true,
  isLoading: false,
  refetch: vi.fn(),
}))
vi.mock("@tanstack/react-query", () => ({ useQuery: () => query }))
beforeEach(() => {
  query.data = undefined
  query.isError = true
  query.refetch.mockReset()
})
it("does not turn network failure into a permission denial", () => {
  const access = useHumanPopupAccess("popup")
  expect(access.state).toBe("unavailable")
  if (access.state === "unavailable") access.retry()
  expect(query.refetch).toHaveBeenCalledOnce()
})
it("retains a known access decision after a background transport failure", () => {
  query.data = { allowed: true, source: "application" }
  expect(useHumanPopupAccess("popup").state).toBe("allowed")
})
it("requires an actual backend decision before reporting denied access", () => {
  query.isError = false
  query.data = { allowed: false, reason: "application_pending" }
  expect(useHumanPopupAccess("popup")).toEqual({
    state: "denied",
    reason: "application_pending",
  })
})
