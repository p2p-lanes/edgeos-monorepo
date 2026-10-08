import { afterEach, describe, expect, it, vi } from "vitest"
import { type EventPublicCalendarResponse, EventsService } from "@/client"
import { fetchAllPublicCalendarEvents } from "./usePublicCalendarEvents"

afterEach(() => vi.restoreAllMocks())
const meta = {
  popup_id: "p",
  popup_slug: "test",
  popup_name: "Test",
  timezone: "UTC",
}
const event = (id: number): EventPublicCalendarResponse["results"][number] => ({
  id: `${id}`,
  title: `Event ${id}`,
  start_time: "2020-10-01T12:00:00Z",
  end_time: "2020-10-01T13:00:00Z",
  timezone: "UTC",
})

describe("public calendar complete schedule", () => {
  it("fetches past the first 200 events and forwards filters on every page", async () => {
    const list = vi
      .spyOn(EventsService, "listPublicCalendar")
      .mockResolvedValueOnce({
        results: Array.from({ length: 200 }, (_, i) => event(i)),
        meta,
        paging: { offset: 0, limit: 200, total: 201 },
      })
      .mockResolvedValueOnce({
        results: [event(200)],
        meta,
        paging: { offset: 200, limit: 200, total: 201 },
      })
    const response = await fetchAllPublicCalendarEvents({
      popupSlug: "test",
      tenantId: "t",
      search: "Event",
      tags: ["tag"],
      trackIds: ["track"],
    })
    expect(response.results).toHaveLength(201)
    expect(response.results.at(-1)?.id).toBe("200")
    expect(list).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        skip: 200,
        limit: 200,
        xTenantId: "t",
        search: "Event",
        tags: ["tag"],
        trackIds: ["track"],
        startAfter: undefined,
        startBefore: undefined,
      }),
    )
  })
  it("returns an empty schedule without looping", async () => {
    const list = vi
      .spyOn(EventsService, "listPublicCalendar")
      .mockResolvedValue({
        results: [],
        meta,
        paging: { offset: 0, limit: 200, total: 0 },
      })
    expect(
      (await fetchAllPublicCalendarEvents({ popupSlug: "test" })).results,
    ).toEqual([])
    expect(list).toHaveBeenCalledTimes(1)
  })
  it("stops if a later page becomes empty", async () => {
    const list = vi
      .spyOn(EventsService, "listPublicCalendar")
      .mockResolvedValueOnce({
        results: [event(0)],
        meta,
        paging: { offset: 0, limit: 200, total: 2 },
      })
      .mockResolvedValueOnce({
        results: [],
        meta,
        paging: { offset: 1, limit: 200, total: 2 },
      })
    expect(
      (await fetchAllPublicCalendarEvents({ popupSlug: "test" })).results,
    ).toHaveLength(1)
    expect(list).toHaveBeenCalledTimes(2)
  })
})
