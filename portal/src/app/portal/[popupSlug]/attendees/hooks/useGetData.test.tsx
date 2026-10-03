import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AttendeeDirectory } from "@/types/Attendee"
import useGetData from "./useGetData"

const mocks = vi.hoisted(() => ({
  listDirectory: vi.fn(),
  city: {
    id: "popup-1",
    takes_applications: true,
    show_attendee_directory: true,
  },
}))

vi.mock("@/client", () => ({
  ApplicationsService: { listAttendeesDirectory: mocks.listDirectory },
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => mocks.city }),
}))

const attendee: AttendeeDirectory = {
  id: "attendee-1",
  first_name: "Visible",
  last_name: "Person",
  email: "visible@example.com",
  telegram: null,
  role: null,
  organization: null,
  residence: "India",
  age: "30",
  gender: "Non-binary",
  picture_url: null,
  participation: [],
  check_in: null,
  check_out: null,
  associated_attendees: [],
}

function renderDirectory() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { ...renderHook(() => useGetData(), { wrapper }), queryClient }
}

beforeEach(() => {
  mocks.listDirectory.mockReset()
  mocks.city.show_attendee_directory = true
  mocks.listDirectory.mockResolvedValue({
    results: [attendee],
    paging: { offset: 0, limit: 10, total: 24 },
  })
})

describe("directory data", () => {
  it("opts into server-side empty-row filtering and keeps the server total", async () => {
    const { result, queryClient } = renderDirectory()
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mocks.listDirectory).toHaveBeenCalledWith({
      popupId: "popup-1",
      skip: 0,
      limit: 10,
      q: undefined,
      hideEmptyRows: true,
    })
    expect(result.current.attendees).toEqual([attendee])
    expect(result.current.totalAttendees).toBe(24)
    expect(queryClient.getQueryCache().getAll()[0].queryKey).toContainEqual({
      hideEmptyRows: true,
    })
    // Extra API fields remain available; this change does not alter the DTO.
    expect(result.current.attendees[0].residence).toBe("India")
  })

  it("keeps the filter enabled when changing page and page size", async () => {
    const { result } = renderDirectory()
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.handlePageChange(2))
    await waitFor(() =>
      expect(mocks.listDirectory).toHaveBeenCalledWith({
        popupId: "popup-1",
        skip: 10,
        limit: 10,
        q: undefined,
        hideEmptyRows: true,
      }),
    )
    act(() => result.current.handlePageSizeChange(20))
    await waitFor(() =>
      expect(mocks.listDirectory).toHaveBeenCalledWith({
        popupId: "popup-1",
        skip: 0,
        limit: 20,
        q: undefined,
        hideEmptyRows: true,
      }),
    )
  })

  it("keeps the filter enabled for debounced searches", async () => {
    const { result } = renderDirectory()
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.setSearchQuery("Visible"))
    await waitFor(() =>
      expect(mocks.listDirectory).toHaveBeenCalledWith({
        popupId: "popup-1",
        skip: 0,
        limit: 10,
        q: "Visible",
        hideEmptyRows: true,
      }),
    )
  })

  it("does not fetch when the popup disables the directory", () => {
    mocks.city.show_attendee_directory = false
    const { result } = renderDirectory()
    expect(result.current.attendeeDirectoryEnabled).toBe(false)
    expect(mocks.listDirectory).not.toHaveBeenCalled()
  })
})
