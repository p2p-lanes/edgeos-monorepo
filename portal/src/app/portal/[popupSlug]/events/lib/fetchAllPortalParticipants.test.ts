import { beforeEach, describe, expect, it, vi } from "vitest"

const listParticipants = vi.hoisted(() => vi.fn())
vi.mock("@/client", () => ({
  EventParticipantsService: { listPortalParticipants: listParticipants },
}))

import { fetchAllPortalParticipants } from "./fetchAllPortalParticipants"

const FIRST = "2031-03-03T10:00:00Z"
const person = (id: string) => ({ id, status: "registered" })

beforeEach(() => listParticipants.mockReset())

describe("complete visible portal roster", () => {
  it("pins every request to the selected occurrence", async () => {
    listParticipants
      .mockResolvedValueOnce({
        results: [person("Maria"), person("Bruno")],
        paging: { offset: 0, limit: 2, total: 3 },
      })
      .mockResolvedValueOnce({
        results: [person("Diego")],
        paging: { offset: 2, limit: 2, total: 3 },
      })
    expect(await fetchAllPortalParticipants("master", FIRST)).toEqual([
      person("Maria"),
      person("Bruno"),
      person("Diego"),
    ])
    expect(listParticipants).toHaveBeenNthCalledWith(1, {
      eventId: "master",
      occurrenceStart: FIRST,
    })
    expect(listParticipants).toHaveBeenNthCalledWith(2, {
      eventId: "master",
      occurrenceStart: FIRST,
      skip: 2,
    })
  })

  it("sends no occurrence timestamp for one-offs or detached children", async () => {
    listParticipants.mockResolvedValue({ results: [] })
    expect(await fetchAllPortalParticipants("child", null)).toEqual([])
    expect(listParticipants).toHaveBeenCalledWith({
      eventId: "child",
      occurrenceStart: undefined,
    })
  })

  it("does not stop when privacy reduces total below the next offset", async () => {
    // 105 raw rows. The first 100 contain 95 omitted names, so total is 10.
    listParticipants
      .mockResolvedValueOnce({
        results: Array.from({ length: 5 }, (_, i) => person(`First ${i}`)),
        paging: { offset: 0, limit: 100, total: 10 },
      })
      .mockResolvedValueOnce({
        results: Array.from({ length: 5 }, (_, i) => person(`Last ${i}`)),
        paging: { offset: 100, limit: 100, total: 105 },
      })
    const results = await fetchAllPortalParticipants("master", FIRST)
    expect(results).toHaveLength(10)
    expect(results.at(-1)).toEqual(person("Last 4"))
    expect(listParticipants).toHaveBeenCalledTimes(2)
  })

  it("continues past entirely omitted pages, including when all names are omitted", async () => {
    // Five raw rows, all omitted. Each page's total excludes only its own drop.
    listParticipants
      .mockResolvedValueOnce({
        results: [],
        paging: { offset: 0, limit: 2, total: 3 },
      })
      .mockResolvedValueOnce({
        results: [],
        paging: { offset: 2, limit: 2, total: 3 },
      })
      .mockResolvedValueOnce({
        results: [],
        paging: { offset: 4, limit: 2, total: 4 },
      })
    expect(await fetchAllPortalParticipants("master", FIRST)).toEqual([])
    expect(listParticipants).toHaveBeenCalledTimes(3)
    expect(listParticipants).toHaveBeenLastCalledWith({
      eventId: "master",
      occurrenceStart: FIRST,
      skip: 4,
    })
  })

  it("does not request an extra page for an empty or short last page", async () => {
    listParticipants.mockResolvedValue({
      results: [],
      paging: { offset: 0, limit: 100, total: 0 },
    })
    expect(await fetchAllPortalParticipants("master", FIRST)).toEqual([])
    expect(listParticipants).toHaveBeenCalledTimes(1)
    listParticipants.mockReset()
    listParticipants.mockResolvedValue({
      results: [person("Maria")],
      paging: { offset: 0, limit: 100, total: 1 },
    })
    expect(await fetchAllPortalParticipants("master", FIRST)).toEqual([
      person("Maria"),
    ])
    expect(listParticipants).toHaveBeenCalledTimes(1)
  })

  it("does not publish a partial roster when a later page fails", async () => {
    listParticipants
      .mockResolvedValueOnce({
        results: [person("Maria")],
        paging: { offset: 0, limit: 1, total: 2 },
      })
      .mockRejectedValueOnce(new Error("Unavailable"))
    await expect(fetchAllPortalParticipants("master", FIRST)).rejects.toThrow(
      "Unavailable",
    )
  })

  it.each([
    { offset: 0, limit: 0, total: 2 },
    { offset: 1, limit: 1, total: 2 },
  ])("rejects pagination that cannot advance safely (%j)", async (paging) => {
    listParticipants.mockResolvedValue({ results: [], paging })
    await expect(fetchAllPortalParticipants("master", FIRST)).rejects.toThrow(
      "Invalid participant pagination",
    )
  })
})
