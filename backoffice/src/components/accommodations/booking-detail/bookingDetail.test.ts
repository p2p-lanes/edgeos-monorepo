import { describe, expect, it } from "vitest"
import {
  chargeOf,
  formatAnswer,
  formatStayDate,
  guestFields,
  nightsLabel,
  personBlocks,
} from "./bookingDetail"

const PASSPORT = { key: "passport", label: "Passport number" }
const DIET = { key: "diet", label: "Diet" }

describe("which questions each person was asked", () => {
  it("repeats the booker's questions for each guest by default", () => {
    // `same_as_booker` stores no fields of its own. Reading the section
    // literally would leave a page full of answers with no questions.
    expect(
      guestFields({
        booker: { fields: [PASSPORT] },
        guests: { mode: "same_as_booker", fields: [] },
      }).map((field) => field.key),
    ).toEqual(["passport"])
  })

  it("uses the guests' own list under custom", () => {
    expect(
      guestFields({
        booker: { fields: [PASSPORT] },
        guests: { mode: "custom", fields: [DIET] },
      }).map((field) => field.key),
    ).toEqual(["diet"])
  })

  it("asks the guests nothing under off", () => {
    expect(
      guestFields({ booker: { fields: [PASSPORT] }, guests: { mode: "off" } }),
    ).toEqual([])
  })

  it("survives a booking made before any of this existed", () => {
    expect(guestFields(null)).toEqual([])
    expect(guestFields(undefined)).toEqual([])
  })
})

describe("personBlocks", () => {
  const booking = {
    form_snapshot: {
      booker: { fields: [PASSPORT] },
      guests: { mode: "custom", fields: [DIET] },
    },
    booker_answers: { passport: "X1" },
    guests: [
      { name: "Ada", answers: { diet: "Vegetarian" } },
      { name: "Grace", answers: {} },
    ],
  }

  it("puts the booking contact first and each guest after, in order", () => {
    expect(personBlocks(booking).map((block) => block.id)).toEqual([
      "booker",
      "guest-0",
      "guest-1",
    ])
  })

  it("labels an answer with the question that was actually asked", () => {
    const [contact] = personBlocks(booking)

    expect(contact.rows).toEqual([
      { key: "passport", label: "Passport number", value: "X1" },
    ])
  })

  it("leaves an unanswered question visible and empty", () => {
    // A blank row says "we asked and got nothing". Dropping it would say
    // "we never asked", which is a different fact.
    const grace = personBlocks(booking)[2]

    expect(grace.rows).toEqual([{ key: "diet", label: "Diet", value: "" }])
  })

  it("still shows an answer whose question was deleted", () => {
    const blocks = personBlocks({
      form_snapshot: { booker: { fields: [] }, guests: { mode: "off" } },
      booker_answers: { passport: "X1" },
      guests: [],
    })

    expect(blocks[0].rows).toEqual([
      { key: "passport", label: "passport", value: "X1", orphaned: true },
    ])
  })

  it("names the guests of a booking that predates the form", () => {
    // Those names were always stored and never shown. The page is where
    // they finally surface.
    const blocks = personBlocks({
      guests: [{ name: "Ada" }, { name: "Grace" }],
    })

    expect(blocks.map((block) => block.name)).toEqual(["Ada", "Grace"])
    expect(blocks[0].rows).toEqual([])
  })

  it("skips a slot with neither a name nor an answer", () => {
    expect(
      personBlocks({ guests: [{ name: "" }, { name: "Ada" }] }).map(
        (block) => block.name,
      ),
    ).toEqual(["Ada"])
  })

  it("honours a title the operator wrote for the contact section", () => {
    expect(
      personBlocks({
        form_snapshot: { booker: { title: "Who we call", fields: [PASSPORT] } },
        booker_answers: {},
      })[0].title,
    ).toBe("Who we call")
  })
})

describe("formatAnswer", () => {
  it("renders a ticked consent as a word, not a boolean", () => {
    expect(formatAnswer(true)).toBe("Yes")
    expect(formatAnswer(false)).toBe("No")
  })

  it("joins a multiselect", () => {
    expect(formatAnswer(["Vegetarian", "Nut allergy"])).toBe(
      "Vegetarian, Nut allergy",
    )
  })

  it("treats nothing as nothing", () => {
    expect(formatAnswer(null)).toBe("")
    expect(formatAnswer(undefined)).toBe("")
  })
})

describe("formatStayDate", () => {
  it("reads a check-in as a day of the week", () => {
    expect(formatStayDate("2026-06-01")).toBe("Mon 1 Jun")
  })

  it("does not slip a day west of Greenwich", () => {
    // `new Date("2026-06-01")` is UTC midnight, which is 31 May in every
    // American timezone. A check-in shown a day early is found at the desk.
    expect(formatStayDate("2026-01-01")).toBe("Thu 1 Jan")
    expect(formatStayDate("2026-12-31")).toBe("Thu 31 Dec")
  })

  it("gives back what it cannot read", () => {
    expect(formatStayDate("")).toBe("")
    expect(formatStayDate("not a date")).toBe("not a date")
  })
})

describe("nightsLabel", () => {
  it("counts one night without a plural", () => {
    expect(nightsLabel(1)).toBe("1 night")
    expect(nightsLabel(7)).toBe("7 nights")
  })
})

describe("chargeOf", () => {
  it("reads the frozen quote", () => {
    expect(
      chargeOf({ subtotal: "100", tax: "21", total: "121", currency: "USD" }),
    ).toEqual({
      subtotal: "100",
      tax: "21",
      total: "121",
      currency: "USD",
    })
  })

  it("has nothing to show for a booking nobody paid for", () => {
    // A staff comp or a blocked range carries no quote, and a card of
    // dashes is worse than no card.
    expect(chargeOf(null)).toBeNull()
    expect(chargeOf({})).toBeNull()
  })
})
