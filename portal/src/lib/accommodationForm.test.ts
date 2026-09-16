/**
 * The guest-details rule, client side.
 *
 * These are the same cases as `TestValidateAnswers` in the backend's
 * `test_guest_form.py`, deliberately. The point of a client copy is that the
 * two agree: a stay this accepts and the purchase then refuses is worse than
 * no client check at all, and so is one this refuses that the API would take.
 *
 * The ordering case at the bottom is the one that matters most. If the two
 * sides disagreed about *which* problem to report first, a buyer would fix
 * the one they were told about and be refused again for another.
 */

import { describe, expect, it } from "vitest"
import {
  type AccommodationGuestForm,
  bookerFieldsOf,
  checkField,
  checkStayAnswers,
  completeGuestCount,
  guestFieldsOf,
  guestsForWire,
  parseGuestForm,
} from "./accommodationForm"

const NAME = {
  key: "full_name",
  type: "text",
  label: "Full name",
  required: true,
}
const EMAIL = { key: "email", type: "email", label: "Email", required: true }
const AGE = {
  key: "age",
  type: "number",
  label: "Age",
  required: false,
  config: { min: 18 },
}
const DIET = {
  key: "diet",
  type: "select",
  label: "Diet",
  required: false,
  options: ["None", "Vegetarian"],
}

function form(overrides: Partial<AccommodationGuestForm> = {}) {
  return {
    version: 1,
    booker: { fields: [NAME] },
    guests: { mode: "same_as_booker" as const, fields: [] },
    ...overrides,
  } as AccommodationGuestForm
}

function stay(overrides: Record<string, unknown> = {}) {
  return {
    guestForm: form(),
    bookerAnswers: {},
    guests: [{ name: "", answers: {} }],
    guestCount: 1,
    ...overrides,
  } as Parameters<typeof checkStayAnswers>[0]
}

const NAMES_REQUIRED = { requireGuestNames: true }
const NAMES_OPTIONAL = { requireGuestNames: false }

describe("which fields apply", () => {
  it("repeats the booker fields for each guest by default", () => {
    expect(guestFieldsOf(form()).map((field) => field.key)).toEqual([
      "full_name",
    ])
  })

  it("asks the guests their own list under custom", () => {
    const custom = form({ guests: { mode: "custom", fields: [AGE] } })

    expect(guestFieldsOf(custom).map((field) => field.key)).toEqual(["age"])
  })

  it("asks the guests nothing under off, while the booker is still asked", () => {
    const off = form({ guests: { mode: "off", fields: [] } })

    expect(guestFieldsOf(off)).toEqual([])
    expect(bookerFieldsOf(off)).toHaveLength(1)
  })

  it("treats no form as nothing to ask", () => {
    expect(guestFieldsOf(null)).toEqual([])
    expect(bookerFieldsOf(undefined)).toEqual([])
  })
})

describe("checkField", () => {
  it("passes an answered required field", () => {
    expect(checkField(NAME, { full_name: "Ada" })).toBeNull()
  })

  it("refuses a required field left blank, and whitespace is blank", () => {
    expect(checkField(NAME, {})).toBe("Full name is required")
    expect(checkField(NAME, { full_name: "  " })).toBe("Full name is required")
  })

  it("lets an optional field be empty", () => {
    expect(checkField(AGE, {})).toBeNull()
  })

  it("refuses something that is not an email", () => {
    expect(checkField(EMAIL, { email: "ada at example" })).toContain(
      "does not look like",
    )
    expect(checkField(EMAIL, { email: "ada@example.com" })).toBeNull()
  })

  it("refuses a choice that was never offered", () => {
    expect(checkField(DIET, { diet: "Carnivore" })).toContain("pick one")
    expect(checkField(DIET, { diet: "Vegetarian" })).toBeNull()
  })

  it("refuses a number below the configured minimum", () => {
    expect(checkField(AGE, { age: 12 })).toBe("Age must be 18 or more")
    expect(checkField(AGE, { age: 30 })).toBeNull()
  })

  it("requires a consent to be ticked, not merely present", () => {
    const terms = {
      key: "terms",
      type: "boolean",
      label: "Terms",
      required: true,
    }

    expect(checkField(terms, { terms: false })).toBe("Terms is required")
    expect(checkField(terms, { terms: true })).toBeNull()
  })
})

describe("checkStayAnswers", () => {
  it("accepts a fully answered stay", () => {
    const ready = stay({
      bookerAnswers: { full_name: "Ada" },
      guests: [{ name: "Ada", answers: { full_name: "Ada" } }],
    })

    expect(checkStayAnswers(ready, NAMES_REQUIRED)).toBeNull()
  })

  it("reports the booker before any guest", () => {
    // Reading order. Reporting a guest's gap while the booker's is also open
    // walks the buyer past the first thing they have to fix.
    const problem = checkStayAnswers(stay(), NAMES_REQUIRED)

    expect(problem?.guestIndex).toBeNull()
    expect(problem?.field).toBe("full_name")
  })

  it("points at the guest whose answer is missing", () => {
    const problem = checkStayAnswers(
      stay({
        guestCount: 2,
        bookerAnswers: { full_name: "Ada" },
        guests: [
          { name: "Ada", answers: { full_name: "Ada" } },
          { name: "Grace", answers: {} },
        ],
      }),
      NAMES_REQUIRED,
    )

    expect(problem?.guestIndex).toBe(1)
    expect(problem?.field).toBe("full_name")
  })

  it("asks for a name only when the step does", () => {
    const noAnswers = stay({
      guestForm: null,
      guests: [{ name: "", answers: {} }],
    })

    expect(checkStayAnswers(noAnswers, NAMES_REQUIRED)?.field).toBe("name")
    expect(checkStayAnswers(noAnswers, NAMES_OPTIONAL)).toBeNull()
  })

  it("checks a slot the buyer never opened", () => {
    // `guests` can be shorter than `guestCount` if a slot was never touched.
    const short = stay({
      guestCount: 3,
      bookerAnswers: { full_name: "Ada" },
      guests: [{ name: "Ada", answers: { full_name: "Ada" } }],
    })

    expect(checkStayAnswers(short, NAMES_REQUIRED)?.guestIndex).toBe(1)
  })

  it("has nothing to say when the property asks nothing", () => {
    expect(
      checkStayAnswers(stay({ guestForm: null }), NAMES_OPTIONAL),
    ).toBeNull()
  })
})

describe("completeGuestCount", () => {
  it("counts the people who are fully answered for", () => {
    const item = stay({
      guestCount: 3,
      guests: [
        { name: "Ada", answers: { full_name: "Ada" } },
        { name: "Grace", answers: {} },
        { name: "", answers: {} },
      ],
    })

    expect(completeGuestCount(item, NAMES_REQUIRED)).toBe(1)
  })

  it("counts a named guest when the property asks nothing else", () => {
    const item = stay({
      guestForm: null,
      guestCount: 2,
      guests: [
        { name: "Ada", answers: {} },
        { name: "", answers: {} },
      ],
    })

    expect(completeGuestCount(item, NAMES_REQUIRED)).toBe(1)
  })
})

describe("guestsForWire", () => {
  it("drops the empty slots the checkout renders", () => {
    expect(
      guestsForWire([
        { name: "Ada", answers: {} },
        { name: "  ", answers: {} },
        { name: "", answers: {} },
      ]),
    ).toEqual([{ name: "Ada", answers: {} }])
  })

  it("keeps a guest who answered but has no name yet", () => {
    // Whether that is acceptable is `require_guest_names`'s decision, and
    // throwing the answers away here would make it silently and lose data.
    expect(guestsForWire([{ name: "", answers: { age: 36 } }])).toEqual([
      { name: "", answers: { age: 36 } },
    ])
  })

  it("trims the name", () => {
    expect(guestsForWire([{ name: " Ada ", answers: {} }])[0].name).toBe("Ada")
  })
})

describe("reading the step's stored form", () => {
  it("reads a form the step saved", () => {
    const parsed = parseGuestForm({ booker: { fields: [NAME] } })

    expect(parsed).not.toBeNull()
    expect(bookerFieldsOf(parsed).map((field) => field.key)).toEqual([
      "full_name",
    ])
  })

  it("treats a step with no questions as no form", () => {
    // The overwhelmingly common case. Callers then have one thing to check
    // rather than three, and the panel does not render an empty section.
    expect(parseGuestForm(undefined)).toBeNull()
    expect(parseGuestForm(null)).toBeNull()
    expect(parseGuestForm({})).toBeNull()
    expect(parseGuestForm({ booker: { fields: [] } })).toBeNull()
  })

  it("counts a form that only asks the other guests", () => {
    expect(
      parseGuestForm({
        booker: { fields: [] },
        guests: { mode: "custom", fields: [DIET] },
      }),
    ).not.toBeNull()
  })

  it("does not choke on something that is not a form", () => {
    // It is reading a JSON column somebody already saved. Refusing to render
    // the step over it would cost a sale to protect nothing.
    expect(parseGuestForm("nonsense")).toBeNull()
    expect(parseGuestForm([1, 2, 3])).toBeNull()
  })
})
