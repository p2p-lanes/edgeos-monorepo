import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  isInitialQueryResolutionPending,
  useInitialQueryResolution,
} from "./initial-query-resolution"

describe("isInitialQueryResolutionPending", () => {
  it("waits for initial data and a stale-cache refetch started on mount", () => {
    expect(
      isInitialQueryResolutionPending({
        isPending: true,
        isFetching: true,
        isFetchedAfterMount: false,
      }),
    ).toBe(true)
    expect(
      isInitialQueryResolutionPending({
        isPending: false,
        isFetching: true,
        isFetchedAfterMount: false,
      }),
    ).toBe(true)
  })

  it("does not blank settled data during later background refetches", () => {
    expect(
      isInitialQueryResolutionPending({
        isPending: false,
        isFetching: true,
        isFetchedAfterMount: true,
      }),
    ).toBe(false)
  })

  it("keeps a screen settled when its first background refetch starts later", () => {
    let state = {
      isPending: false,
      isFetching: false,
      isFetchedAfterMount: false,
    }
    const { result, rerender } = renderHook(() =>
      useInitialQueryResolution("popup-1", state),
    )

    expect(result.current).toBe(false)

    state = { ...state, isFetching: true }
    rerender()

    expect(result.current).toBe(false)
  })
})
