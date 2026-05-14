import { describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  AttendeeCategoriesService: {
    listAttendeeCategories: vi.fn(),
  },
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
}))

describe("useAttendeeCategories", () => {
  it("is a function that accepts a popupId", async () => {
    const { useAttendeeCategories } = await import("./useAttendeeCategories")
    expect(typeof useAttendeeCategories).toBe("function")
  })

  it("calls useQuery with correct queryKey and staleTime", async () => {
    const { useQuery } = await import("@tanstack/react-query")
    const mockUseQuery = vi.mocked(useQuery)
    mockUseQuery.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as any)

    const { useAttendeeCategories } = await import("./useAttendeeCategories")
    useAttendeeCategories("popup-abc")

    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["attendee-categories", "popup-abc"],
        staleTime: 5 * 60 * 1000,
      }),
    )
  })

  it("returns categories from query data", async () => {
    const { useQuery } = await import("@tanstack/react-query")
    const mockUseQuery = vi.mocked(useQuery)
    const sortedCategories = [
      {
        id: "cat-1",
        key: "main",
        is_primary: true,
        sort_order: 0,
        enabled_in_passes_flow: true,
        display_meta: {},
        required_fields: [],
        popup_id: "popup-1",
        tenant_id: "tenant-1",
      },
      {
        id: "cat-2",
        key: "kid",
        is_primary: false,
        sort_order: 2,
        enabled_in_passes_flow: true,
        display_meta: {},
        required_fields: [],
        popup_id: "popup-1",
        tenant_id: "tenant-1",
      },
    ]
    mockUseQuery.mockReturnValue({
      data: sortedCategories,
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as any)

    const { useAttendeeCategories } = await import("./useAttendeeCategories")
    const result = useAttendeeCategories("popup-1")

    expect(result.categories).toHaveLength(2)
    expect(result.categories![0].key).toBe("main")
    expect(result.categories![1].key).toBe("kid")
  })

  it("returns isLoading: true while fetching", async () => {
    const { useQuery } = await import("@tanstack/react-query")
    vi.mocked(useQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      isSuccess: false,
    } as any)

    const { useAttendeeCategories } = await import("./useAttendeeCategories")
    const result = useAttendeeCategories("popup-1")

    expect(result.isLoading).toBe(true)
    expect(result.categories).toBeUndefined()
  })
})
