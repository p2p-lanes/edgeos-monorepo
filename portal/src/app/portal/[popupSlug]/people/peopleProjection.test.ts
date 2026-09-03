import { describe, expect, it } from "vitest"
import type { AttendeeWithOriginPublic } from "@/client"
import { projectPeople } from "./peopleProjection"

describe("projectPeople", () => {
  it("keeps a zero-ticket dependent and identifies their managed relationship", () => {
    const people = projectPeople([
      {
        id: "primary",
        name: "Alex Morgan",
        category: "main",
        products: [
          {
            id: "ticket",
            product_id: "ticket",
            attendee_id: "primary",
            check_in_code: "A",
          },
        ],
      } as unknown as AttendeeWithOriginPublic,
      {
        id: "dependent",
        name: "Jamie Morgan",
        category: "spouse",
        products: [],
      } as unknown as AttendeeWithOriginPublic,
    ])

    expect(people).toEqual([
      {
        id: "primary",
        name: "Alex Morgan",
        relationship: "primary",
        canManage: true,
      },
      {
        id: "dependent",
        name: "Jamie Morgan",
        relationship: "dependent",
        canManage: true,
      },
    ])
  })

  it("uses a dependent relationship for non-primary categories without exposing products", () => {
    const people = projectPeople([
      {
        id: "child",
        name: "Sam Morgan",
        category: "child",
        products: [
          {
            id: "merch",
            product_id: "merch",
            attendee_id: "child",
            check_in_code: "M",
          },
        ],
      } as unknown as AttendeeWithOriginPublic,
    ])

    expect(people).toEqual([
      {
        id: "child",
        name: "Sam Morgan",
        relationship: "dependent",
        canManage: true,
      },
    ])
  })
})
