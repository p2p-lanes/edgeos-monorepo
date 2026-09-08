/**
 * Who is staying, in the checkout.
 *
 * What is worth pinning is the behaviour a buyer would notice going wrong:
 * only the lead guest is open on arrival, a collapsed card still says whether
 * it is done, and copying from the lead guest fills the shared answers without
 * taking their name with it.
 */

import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

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
const setAccommodationGuestCount = vi.fn()

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    setAccommodationGuestCount,
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
    <GuestDetailsPanel
      item={item}
      capacity={4}
      requireGuestNames={requireGuestNames}
    />,
  )
}

describe("the lead guest block", () => {
  it("asks the booker questions once for the room", () => {
    renderPanel()

    expect(screen.getByText("Booking contact")).toBeTruthy()
    expect(screen.getAllByText(/Email/).length).toBeGreaterThan(0)
  })

  it("does not appear when the property asks the booker nothing", () => {
    renderPanel(stay({ guestForm: null }))

    expect(screen.queryByText("Booking contact")).toBeNull()
    // Names are still collected: that is the step's setting, not the form's.
    expect(screen.getByText("Guest 2")).toBeTruthy()
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
})

describe("party size", () => {
  it("resizes through the provider", () => {
    renderPanel()

    fireEvent.change(screen.getByLabelText("Guests"), {
      target: { value: "3" },
    })

    expect(setAccommodationGuestCount).toHaveBeenCalled()
  })
})
