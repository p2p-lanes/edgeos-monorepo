import { describe, expect, it } from "vitest"
import { ApplicationStatusSchema } from "@/client/schemas.gen"
import { APPLICATION_STATUS_OPTIONS } from "./application-status"

describe("application status filters and groups", () => {
  it("offers every API status, including withdrawn", () => {
    expect(
      APPLICATION_STATUS_OPTIONS.map((option) => option.value).sort(),
    ).toEqual([...ApplicationStatusSchema.enum].sort())
    expect(APPLICATION_STATUS_OPTIONS).toContainEqual({
      value: "withdrawn",
      label: "Withdrawn",
    })
  })
})
