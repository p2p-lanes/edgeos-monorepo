import { describe, expect, it } from "vitest"
import { getPersonInitials, orderPeopleForDisplay } from "./peoplePresentation"
import type { PortalPerson } from "./peopleProjection"

const primary: PortalPerson = {
  id: "primary",
  name: "Alex Morgan",
  relationship: "primary",
  canManage: true,
}

const dependent: PortalPerson = {
  id: "dependent",
  name: "Jamie Morgan",
  relationship: "dependent",
  canManage: true,
}

describe("orderPeopleForDisplay", () => {
  it("places the primary attendee before dependents while preserving each group order", () => {
    expect(
      orderPeopleForDisplay([
        dependent,
        primary,
        { ...dependent, id: "dependent-2", name: "Taylor Morgan" },
      ]),
    ).toEqual([
      primary,
      dependent,
      { ...dependent, id: "dependent-2", name: "Taylor Morgan" },
    ])
  })

  it("keeps a dependent-only list in its original order", () => {
    const secondDependent = {
      ...dependent,
      id: "dependent-2",
      name: "Taylor Morgan",
    }

    expect(orderPeopleForDisplay([dependent, secondDependent])).toEqual([
      dependent,
      secondDependent,
    ])
  })
})

describe("getPersonInitials", () => {
  it("uses the first character from the first two name parts", () => {
    expect(getPersonInitials("Alex Morgan")).toBe("AM")
  })

  it("uses the available name part when a person has one name", () => {
    expect(getPersonInitials("Madonna")).toBe("M")
  })
})
