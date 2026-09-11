/**
 * Who is staying, in the checkout.
 *
 * Two things are being pinned. First, what the checkout already knows about
 * the buyer is not asked again here: the panel used to open with an email
 * field the buyer step asked for a second time three screens later, and the
 * point of this panel now is how little of it is left. Second, the parts
 * that were never duplicated still work exactly as they did, because the
 * other occupants are people this checkout has never heard of.
 *
 * The identity is varied per test rather than fixed, because the two funnels
 * differ: a direct sale knows the buyer from the buyer step, an application
 * flow from the account, and a checkout that knows neither must fall back to
 * asking everything.
 */

import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { stayAsksAnything } from "@/lib/accommodationForm"
import {
  type BuyerIdentity,
  buildBuyerIdentity,
  NO_BUYER_IDENTITY,
} from "@/lib/buyerIdentity"
import type { SelectedAccommodationItem } from "@/types/checkout"

/**
 * Resolve against the real English catalogue rather than echoing the key.
 * The assertions are then about the sentence a buyer reads, and a key that
 * does not exist fails here instead of shipping as a raw dotted string.
 */
vi.mock("react-i18next", async () => {
  const en = (await import("@/i18n/locales/en.json")).default as Record<
    string,
    unknown
  >
  const lookup = (path: string): unknown =>
    path
      .split(".")
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown>)?.[part],
        en,
      )
  return {
    useTranslation: () => ({
      t: (key: string, vars?: Record<string, unknown>) => {
        const count = vars?.count
        const plural =
          count === undefined ? null : count === 1 ? "_one" : "_other"
        const template =
          (plural ? lookup(`${key}${plural}`) : null) ?? lookup(key)
        if (typeof template !== "string") return key
        return template.replace(/\{\{(\w+)\}\}/g, (_full, name: string) =>
          String(vars?.[name] ?? ""),
        )
      },
    }),
  }
})

const setAccommodationGuestName = vi.fn()
const setAccommodationBookerAnswer = vi.fn()
const setAccommodationGuestAnswer = vi.fn()
const copyBookerAnswersToGuest = vi.fn()

let buyerIdentity: BuyerIdentity = NO_BUYER_IDENTITY

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    buyerIdentity,
    setAccommodationGuestName,
    setAccommodationBookerAnswer,
    setAccommodationGuestAnswer,
    copyBookerAnswersToGuest,
  }),
}))

import { GuestDetailsPanel } from "./GuestDetailsPanel"

const EMAIL = { key: "email", type: "email", label: "Email", required: true }
const NAME = {
  key: "full_name",
  type: "text",
  label: "Full name",
  required: true,
}

/** A direct sale, after the buyer step has been filled in. */
const KNOWN_BUYER = buildBuyerIdentity({
  buyerFormSchema: {
    base_fields: {
      email: { type: "email", label: "Email", required: true },
      first_name: { type: "text", label: "First name", required: true },
      last_name: { type: "text", label: "Last name", required: true },
    },
    custom_fields: {},
    sections: [],
  },
  buyerValues: {
    email: "ada@example.com",
    first_name: "Ada",
    last_name: "Lovelace",
  },
})

function stay(overrides: Partial<SelectedAccommodationItem> = {}) {
  return {
    accommodationId: "room-1",
    productId: "product-1",
    name: "Classic Double",
    propertyId: "prop-1",
    propertyName: "Hotel Arcadia",
    checkIn: "2026-09-14",
    checkOut: "2026-09-18",
    nights: 4,
    guestCount: 2,
    guests: [
      { name: "", answers: {} },
      { name: "", answers: {} },
    ],
    bookerAnswers: {},
    guestForm: {
      version: 1,
      booker: { fields: [EMAIL, NAME] },
      guests: { mode: "same_as_booker", fields: [] },
    },
    subtotal: 400,
    tax: 40,
    totalPrice: 440,
    ...overrides,
  } as SelectedAccommodationItem
}

function renderPanel(item = stay(), requireGuestNames = true) {
  return render(
    <GuestDetailsPanel item={item} requireGuestNames={requireGuestNames} />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  buyerIdentity = NO_BUYER_IDENTITY
})

describe("what the checkout already knows", () => {
  it("stops asking the buyer for what the buyer step asks them", () => {
    buyerIdentity = KNOWN_BUYER
    renderPanel()

    // Both booker questions are the buyer's own email and name, so the
    // block they lived in has nothing left to hold.
    expect(screen.queryByText("Booking contact")).toBeNull()
    expect(screen.queryByRole("button", { name: /Lead guest/ })).toBeNull()
  })

  it("says nothing about the buyer at all", () => {
    // Their name is on the booking and reaches the property, but announcing
    // it back to the person who just typed it is noise in the middle of a
    // room selection.
    buyerIdentity = KNOWN_BUYER
    renderPanel()

    expect(screen.queryByText(/Ada Lovelace/)).toBeNull()
    expect(screen.queryByText(/ada@example.com/)).toBeNull()
  })

  it("leaves a party of one nothing at all to fill in", () => {
    // The whole point of the change: the common booking asks nothing, and
    // the step drops the block rather than drawing an empty one.
    buyerIdentity = KNOWN_BUYER
    const item = stay({ guestCount: 1, guests: [{ name: "", answers: {} }] })

    expect(
      stayAsksAnything(item, {
        requireGuestNames: true,
        identity: KNOWN_BUYER,
      }),
    ).toBe(false)

    renderPanel(item)
    expect(screen.queryByRole("button", { name: /Guest/ })).toBeNull()
    expect(screen.queryByText(/missing/)).toBeNull()
  })

  it("asks the lead occupant for a name when nothing else knows it", () => {
    // An account with no name on it. Skipping the card here would leave the
    // funnel demanding a name that no field on the screen collects, which is
    // a checkout nobody can finish.
    buyerIdentity = buildBuyerIdentity({
      human: { email: "someone@example.com" },
    })
    renderPanel(
      stay({
        guestCount: 1,
        guests: [{ name: "", answers: {} }],
        guestForm: null,
      }),
    )

    // Open on arrival, because it is the only card there is.
    expect(screen.getByLabelText("Full name")).toBeTruthy()
  })

  it("keeps asking the other occupants, who are not the buyer", () => {
    // And opens the first of them, because the card that used to be open on
    // arrival was the buyer's and it is no longer there.
    buyerIdentity = KNOWN_BUYER
    renderPanel()

    const second = screen.getByRole("button", { name: /Guest 2/ })
    expect(second.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getAllByText(/Email/).length).toBeGreaterThan(0)
  })

  it("asks for everything when it knows nobody", () => {
    // An application flow whose account carries no name, which is the only
    // way a checkout reaches this panel knowing nothing.
    renderPanel()

    expect(screen.getByText("Booking contact")).toBeTruthy()
    expect(screen.getByRole("button", { name: /Lead guest/ })).toBeTruthy()
  })

  it("still asks whatever the buyer step does not", () => {
    buyerIdentity = KNOWN_BUYER
    renderPanel(
      stay({
        guestForm: {
          version: 1,
          booker: {
            fields: [
              EMAIL,
              {
                key: "passport",
                type: "text",
                label: "Passport number",
                required: true,
              },
            ],
          },
          guests: { mode: "off", fields: [] },
        },
      }),
    )

    expect(screen.getByText("Booking contact")).toBeTruthy()
    expect(screen.getAllByText(/Passport number/).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText("Email")).toBeNull()
  })
})

describe("the guest cards", () => {
  it("opens only the first one", () => {
    renderPanel()

    const first = screen.getByRole("button", { name: /Lead guest/ })
    const second = screen.getByRole("button", { name: /Guest 2/ })

    expect(first.getAttribute("aria-expanded")).toBe("true")
    expect(second.getAttribute("aria-expanded")).toBe("false")
  })

  it("says what is missing without being opened", () => {
    // Twenty-four inputs on one screen is why these collapse. The state of
    // the party has to be legible with them shut.
    renderPanel()

    const second = screen.getByRole("button", { name: /Guest 2/ })
    expect(within(second).getByText(/missing/)).toBeTruthy()
  })

  it("says complete once a guest is answered for", () => {
    const item = stay({
      guests: [
        {
          name: "Ada",
          answers: { email: "ada@example.com", full_name: "Ada" },
        },
        { name: "", answers: {} },
      ],
    })
    renderPanel(item)

    const first = screen.getByRole("button", { name: /Lead guest/ })
    expect(within(first).getByText("Complete")).toBeTruthy()
  })

  it("counts how many of the party are done", () => {
    const item = stay({
      guests: [
        {
          name: "Ada",
          answers: { email: "ada@example.com", full_name: "Ada" },
        },
        { name: "", answers: {} },
      ],
    })
    renderPanel(item)

    expect(screen.getByText("1 of 2 guests complete")).toBeTruthy()
  })

  it("counts the buyer as done rather than as missing", () => {
    // Their answers are not on this screen, which is not the same as absent.
    buyerIdentity = KNOWN_BUYER
    renderPanel()

    expect(screen.getByText("1 of 2 guests complete")).toBeTruthy()
  })

  it("shows a name instead of the placeholder once it is typed in", () => {
    renderPanel(
      stay({
        guests: [
          { name: "Ada", answers: {} },
          { name: "Grace Hopper", answers: {} },
        ],
      }),
    )

    const second = screen.getByRole("button", { name: /Guest 2/ })
    expect(within(second).getByText("Grace Hopper")).toBeTruthy()
  })
})

describe("same as lead guest", () => {
  it("offers the shortcut on the other guests only", () => {
    renderPanel()

    // The lead guest is open; copying onto themselves is meaningless.
    expect(screen.queryByText("Same as lead guest")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /Guest 2/ }))

    expect(screen.getByText("Same as lead guest")).toBeTruthy()
  })

  it("copies the shared keys and not the name", () => {
    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: /Guest 2/ }))

    fireEvent.click(screen.getByText("Same as lead guest"))

    expect(copyBookerAnswersToGuest).toHaveBeenCalledWith(
      "room-1",
      "2026-09-14",
      "2026-09-18",
      1,
      ["email", "full_name"],
    )
    expect(setAccommodationGuestName).not.toHaveBeenCalled()
  })

  it("is not offered when the guests are asked something else entirely", () => {
    const item = stay({
      guestForm: {
        version: 1,
        booker: { fields: [EMAIL] },
        guests: {
          mode: "custom",
          fields: [
            { key: "age", type: "number", label: "Age", required: false },
          ],
        },
      },
    })
    renderPanel(item)
    fireEvent.click(screen.getByRole("button", { name: /Guest 2/ }))

    expect(screen.queryByText("Same as lead guest")).toBeNull()
  })

  it("is not offered once the booker has nothing left to copy", () => {
    // The shortcut copies the booking's shared answers. With the buyer's own
    // struck off, there is nothing under it, and a button that does nothing
    // is worse than no button.
    buyerIdentity = KNOWN_BUYER
    renderPanel()

    expect(screen.queryByText("Same as lead guest")).toBeNull()
  })
})

describe("party size", () => {
  it("is not asked for here", () => {
    // It moved above the rooms, where it decides which rooms exist at all.
    // Asked here it could only resize a booking already made against a room
    // that may not hold the new party.
    renderPanel()

    expect(screen.queryByLabelText("Guests")).toBeNull()
  })
})
