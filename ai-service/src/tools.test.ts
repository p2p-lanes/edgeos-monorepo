import { describe, expect, it } from "vitest"
import {
  prepareCustomExportInputSchema,
  searchExportFieldsInputSchema,
  searchOperationsInputSchema,
} from "./tools.js"

describe("searchOperations input", () => {
  it("accepts provider-generated empty placeholders while searching", () => {
    expect(
      searchOperationsInputSchema.parse({
        query: "find attendees by name",
        operationId: " ",
        mode: "read",
        limit: 5,
      }),
    ).toEqual({
      query: "find attendees by name",
      operationId: " ",
      mode: "read",
      limit: 5,
    })
  })

  it("accepts provider-generated empty placeholders while inspecting", () => {
    expect(
      searchOperationsInputSchema.parse({
        query: " ",
        operationId: "attendees-get_attendee",
        mode: "read",
        limit: 1,
      }),
    ).toEqual({
      query: " ",
      operationId: "attendees-get_attendee",
      mode: "read",
      limit: 1,
    })
  })

  it("validates custom export discovery and plans", () => {
    expect(
      searchExportFieldsInputSchema.parse({ dataset: "applications" }),
    ).toEqual({ dataset: "applications" })
    expect(
      prepareCustomExportInputSchema.parse({
        dataset: "applications",
        columns: [
          { field: "human.email", label: "Email" },
          { field: "payments.approved_total" },
        ],
        filters: [
          { field: "application.status", operator: "eq", value: "accepted" },
        ],
        format: "xlsx",
        filename: "accepted-applications",
      }),
    ).toMatchObject({
      dataset: "applications",
      format: "xlsx",
      columns: expect.arrayContaining([
        { field: "human.email", label: "Email" },
      ]),
    })
  })
})
