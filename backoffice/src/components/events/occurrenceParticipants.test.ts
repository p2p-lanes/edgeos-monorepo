import { beforeEach, describe, expect, it, vi } from "vitest"

const listParticipants = vi.hoisted(() => vi.fn())
vi.mock("@/client", () => ({
  EventParticipantsService: { listParticipants },
}))

import { loadOccurrenceParticipants } from "./occurrenceParticipants"

beforeEach(() => vi.clearAllMocks())

describe("occurrence participant reads", () => {
  it("loads every page before counting active RSVPs", async () => {
    listParticipants
      .mockResolvedValueOnce({
        results: [
          { id: "1", status: "registered" },
          { id: "2", status: "cancelled" },
        ],
        paging: { offset: 0, limit: 2, total: 3 },
      })
      .mockResolvedValueOnce({
        results: [{ id: "3", status: "checked_in" }],
        paging: { offset: 2, limit: 2, total: 3 },
      })
    const start = "2031-03-03T10:00:00Z"
    expect(await loadOccurrenceParticipants("master", start)).toEqual([
      { id: "1", status: "registered" },
      { id: "3", status: "checked_in" },
    ])
    expect(listParticipants).toHaveBeenLastCalledWith({
      eventId: "master",
      occurrenceStart: start,
      scopeToOccurrence: true,
      skip: 2,
    })
  })

  it("explicitly selects NULL for detached children instead of all their rows", async () => {
    listParticipants.mockResolvedValue({ results: [] })
    expect(await loadOccurrenceParticipants("child", null)).toEqual([])
    expect(listParticipants).toHaveBeenCalledWith({
      eventId: "child",
      occurrenceStart: undefined,
      scopeToOccurrence: true,
    })
  })

  it("does not return a partial roster when a later page fails", async () => {
    listParticipants
      .mockResolvedValueOnce({
        results: [{ id: "1", status: "registered" }],
        paging: { offset: 0, limit: 1, total: 2 },
      })
      .mockRejectedValueOnce(new Error("Unavailable"))
    await expect(
      loadOccurrenceParticipants("master", "2031-03-03T10:00:00Z"),
    ).rejects.toThrow("Unavailable")
  })
})
