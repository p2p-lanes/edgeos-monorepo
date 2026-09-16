import { describe, expect, it } from "vitest"
import { parseBusinessResults } from "./BusinessResultTool"
import type { GenericToolPart } from "./tool-types"

describe("parseBusinessResults", () => {
  it("turns application reads into business entities", () => {
    const part: GenericToolPart = {
      type: "tool-executeOperation",
      state: "output-available",
      output: {
        operation: {
          operationId: "application-reviews-list_pending_reviews",
          method: "GET",
          summary: "List Pending Reviews",
        },
        status: 200,
        context: {
          activeGathering: { id: "popup-1", name: "Festival" },
          targetGatherings: [{ id: "popup-1", name: "Festival" }],
          crossContext: false,
          resolution: "verified",
        },
        data: {
          results: [
            {
              id: "application-1",
              status: "in_review",
              submitted_at: "2026-07-24T18:25:47Z",
              human: {
                first_name: "Carol",
                last_name: "Williams",
                email: "carol@example.com",
              },
            },
          ],
          paging: { total: 1 },
        },
      },
    }

    expect(parseBusinessResults(part)).toEqual({
      resource: "application",
      label: "applications",
      total: 1,
      gatherings: ["Festival"],
      crossContext: false,
      items: [
        {
          id: "application-1",
          primary: "Carol Williams",
          secondary: "carol@example.com",
          meta: expect.stringContaining("Jul 24"),
          status: "In review",
        },
      ],
    })
  })

  it("ignores single-record reads and persisted summaries", () => {
    expect(
      parseBusinessResults({
        type: "tool-executeOperation",
        state: "output-available",
        output: {
          operation: {
            operationId: "applications-get_application",
            method: "GET",
            summary: "Get Application",
          },
          status: 200,
          data: { persistedSummary: true },
        },
      }),
    ).toBeNull()
  })
})
