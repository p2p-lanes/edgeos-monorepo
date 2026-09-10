/**
 * What the accommodation step puts on screen for a stay.
 *
 * Two things are being pinned. First, a room the buyer cannot book does not
 * appear, and what was removed is accounted for in a sentence with a button
 * where one is possible: hiding without that is worse than the greyed-out
 * cards it replaced. Second, all three layouts offer the same room, the same
 * price and the same action, so `layout` stays a presentation choice and
 * never becomes a behavioural one.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NO_BUYER_IDENTITY } from "@/lib/buyerIdentity"

const listPortalAccommodations = vi.fn()
const checkPortalAccommodationAvailability = vi.fn()

vi.mock("@/client", () => ({
  CheckoutService: {
    listCheckoutAccommodations: vi.fn(),
    checkAccommodationAvailability: vi.fn(),
  },
  AccommodationsService: {
    listPortalAccommodations: (...args: unknown[]) =>
      listPortalAccommodations(...args),
    checkPortalAccommodationAvailability: (...args: unknown[]) =>
      checkPortalAccommodationAvailability(...args),
  },
}))

const addAccommodation = vi.fn()
const removeAccommodation = vi.fn()
const clearAccommodationsOutsideStay = vi.fn()

const checkoutValue = {
  cart: { accommodations: [] as unknown[] },
  buyerIdentity: NO_BUYER_IDENTITY,
  addAccommodation,
  removeAccommodation,
  clearAccommodationsOutsideStay,
  setAccommodationGuestCount: vi.fn(),
  setAccommodationGuestName: vi.fn(),
  setAccommodationBookerAnswer: vi.fn(),
  setAccommodationGuestAnswer: vi.fn(),
  copyBookerAnswersToGuest: vi.fn(),
  previewToken: null as string | null,
  salesFlowId: "flow-application",
  salesFlowSlug: "application",
  submitMode: "application" as const,
}

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => checkoutValue,
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => ({ id: "popup-1", slug: "edge-city", currency: "USD" }),
  }),
}))

/**
 * Resolve against the real English catalogue: the assertions are then about
 * the sentence a buyer reads, and a key that does not exist fails here
 * instead of shipping as a raw dotted string.
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

import VariantAccommodationBooking from "./VariantAccommodationBooking"

function room(overrides: Record<string, unknown> = {}) {
  return {
    id: "studio",
    property_id: "prop-1",
    product_id: "product-studio",
    name: "Garden Studio",
    kind: "studio",
    description: null,
    guest_capacity: 2,
    beds: [{ type: "queen", count: 1 }],
    default_nightly_price: "145.00",
    long_stay_price: null,
    min_stay: 2,
    bookable_from: "2026-08-01",
    bookable_to: "2026-09-30",
    images: [],
    ...overrides,
  }
}

function priced(id: string, overrides: Record<string, unknown> = {}) {
  return {
    accommodation_id: id,
    available: 4,
    unavailable_reason: null,
    quote: {
      nights: [],
      night_count: 2,
      subtotal: "290.00",
      tax: "0",
      total: "290.00",
      applied_rule: "default",
    },
    ...overrides,
  }
}

function refused(id: string, reason: string) {
  return {
    accommodation_id: id,
    available: 0,
    unavailable_reason: reason,
    quote: null,
  }
}

const ROOMS = [
  room(),
  room({ id: "casita", name: "Casita Azul", min_stay: 4, guest_capacity: 6 }),
  room({ id: "twin", name: "Twin Room" }),
]

const OFFER = {
  properties: [{ id: "prop-1", name: "Casa del Lago" }],
  accommodations: ROOMS,
  currency: "USD",
}

/** The step's own cart entry for the Garden Studio. */
function chosen() {
  return {
    accommodationId: "studio",
    productId: "product-studio",
    name: "Garden Studio",
    propertyId: "prop-1",
    propertyName: "Casa del Lago",
    checkIn: "2026-08-01",
    checkOut: "2026-08-03",
    nights: 2,
    guestCount: 1,
    guests: [{ name: "", answers: {} }],
    bookerAnswers: {},
    guestForm: null,
    subtotal: 290,
    tax: 0,
    totalPrice: 290,
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function renderStep(templateConfig: Record<string, unknown> | null = null) {
  return render(
    <VariantAccommodationBooking
      products={[]}
      stepType="housing"
      templateConfig={templateConfig}
    />,
    { wrapper },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  checkoutValue.cart.accommodations = []
  listPortalAccommodations.mockResolvedValue(OFFER)
  checkPortalAccommodationAvailability.mockResolvedValue([
    priced("studio"),
    refused("casita", "min_stay_not_met"),
    refused("twin", "sold_out"),
  ])
})

describe("what reaches the board", () => {
  it("shows only the rooms that can actually be booked", async () => {
    renderStep()

    expect(await screen.findByText("Garden Studio")).toBeTruthy()
    expect(screen.queryByText("Casita Azul")).toBeNull()
    expect(screen.queryByText("Twin Room")).toBeNull()
  })

  it("counts what is on offer for these nights", async () => {
    renderStep()

    expect(await screen.findByText("1 room for these nights")).toBeTruthy()
  })

  it("offers the stay that brings a removed room back", async () => {
    renderStep()

    expect(
      await screen.findByText("1 more room opens at 4 nights."),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Stay 4 nights" })).toBeTruthy()
  })

  it("re-prices for the longer stay when that button is taken", async () => {
    renderStep()
    fireEvent.click(
      await screen.findByRole("button", { name: "Stay 4 nights" }),
    )

    await waitFor(() =>
      expect(checkPortalAccommodationAvailability).toHaveBeenLastCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            check_in: "2026-08-01",
            check_out: "2026-08-05",
          }),
        }),
      ),
    )
  })

  it("counts what is taken without pretending there is a way back", async () => {
    // Finding the next free dates needs a search the server does not offer,
    // so this states the fact and stops.
    renderStep()

    expect(
      await screen.findByText("1 room is booked for these nights."),
    ).toBeTruthy()
  })

  it("says so plainly when the stay leaves nothing", async () => {
    checkPortalAccommodationAvailability.mockResolvedValue([
      refused("studio", "sold_out"),
      refused("casita", "sold_out"),
      refused("twin", "sold_out"),
    ])
    renderStep()

    expect(await screen.findByText(/No rooms for/)).toBeTruthy()
    expect(
      screen.getByText("3 rooms are booked for these nights."),
    ).toBeTruthy()
  })

  it("never mentions a room that is not on sale", async () => {
    checkPortalAccommodationAvailability.mockResolvedValue([
      priced("studio"),
      refused("casita", "inactive"),
      refused("twin", "inactive"),
    ])
    renderStep()

    await screen.findByText("Garden Studio")
    expect(screen.queryByText(/booked for these nights/)).toBeNull()
    expect(screen.getByText("1 room for these nights")).toBeTruthy()
  })
})

describe("the party size", () => {
  it("goes to the server, so a room too small never reaches the board", async () => {
    renderStep()
    await screen.findByText("Garden Studio")

    fireEvent.click(screen.getByRole("button", { name: "One guest more" }))

    await waitFor(() =>
      expect(checkPortalAccommodationAvailability).toHaveBeenLastCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({ guest_count: 2 }),
        }),
      ),
    )
  })

  it("stops at the largest room on offer", async () => {
    // Asking for more than any room holds can only ever find nothing, and
    // the empty board would not say that the number was the problem.
    renderStep()
    await screen.findByText("Garden Studio")

    const more = screen.getByRole("button", { name: "One guest more" })
    for (let click = 0; click < 8; click += 1) fireEvent.click(more)

    expect(screen.getByText("6")).toBeTruthy()
    expect(more.hasAttribute("disabled")).toBe(true)
  })

  it("is what the booked room is booked for", async () => {
    renderStep()
    await screen.findByText("Garden Studio")

    fireEvent.click(screen.getByRole("button", { name: "One guest more" }))
    await waitFor(() =>
      expect(checkPortalAccommodationAvailability).toHaveBeenCalledTimes(2),
    )
    fireEvent.click(screen.getByRole("radio"))

    expect(addAccommodation).toHaveBeenCalledWith(
      expect.objectContaining({ guestCount: 2 }),
    )
    expect(addAccommodation.mock.calls[0][0].guests).toHaveLength(2)
  })
})

describe("the three layouts", () => {
  it("offers a room the same way in each of them", async () => {
    for (const layout of ["rows", "cards", "sheet"]) {
      const view = renderStep({ layout })
      expect(await screen.findByText("Garden Studio")).toBeTruthy()
      expect(screen.getAllByText("$290").length).toBeGreaterThan(0)
      // The card is the control in all three: no layout has a button that
      // books the room, and none of them books it by being read about.
      expect(screen.getByRole("radio").getAttribute("aria-checked")).toBe(
        "false",
      )
      expect(screen.queryByRole("button", { name: "Select" })).toBeNull()
      view.unmount()
    }
  })

  it("books the room from the card in each of them", async () => {
    for (const layout of ["rows", "cards", "sheet"]) {
      const view = renderStep({ layout })
      await screen.findByText("Garden Studio")

      fireEvent.click(screen.getByRole("radio"))

      expect(addAccommodation).toHaveBeenCalledTimes(1)
      addAccommodation.mockClear()
      view.unmount()
    }
  })

  it("lets the chosen room go when it is clicked again", async () => {
    // Not what a radio does, and deliberate: no room is a valid answer
    // here, so the way out has to be where the way in was.
    for (const layout of ["rows", "cards", "sheet"]) {
      checkoutValue.cart.accommodations = [chosen()]
      const view = renderStep({ layout })
      // By role, not by name: the guest panel prints the room's name too,
      // and it is on screen before the board has been priced.
      const card = await screen.findByRole("radio")
      expect(card.getAttribute("aria-checked")).toBe("true")
      fireEvent.click(card)

      expect(removeAccommodation).toHaveBeenCalledWith(
        "studio",
        expect.any(String),
        expect.any(String),
      )
      expect(addAccommodation).not.toHaveBeenCalled()
      removeAccommodation.mockClear()
      view.unmount()
    }
  })

  it("opens the same room screen from each of them", async () => {
    for (const layout of ["rows", "cards", "sheet"]) {
      const view = renderStep({ layout })
      await screen.findByText("Garden Studio")

      fireEvent.click(screen.getByRole("button", { name: "View details" }))

      expect(screen.getByRole("dialog")).toBeTruthy()
      // Reading about a room is not choosing it.
      expect(addAccommodation).not.toHaveBeenCalled()
      view.unmount()
    }
  })

  it("still understands the two names the step shipped with", async () => {
    // "grid" and "list" are stored on steps nobody has edited since the
    // rename, and the backend only renames them when the step is saved.
    renderStep({ layout: "grid" })
    await screen.findByText("Garden Studio")

    expect(screen.getByRole("radio")).toBeTruthy()
  })
})

/**
 * The room's own screen.
 *
 * A board has to fit every room at once, so it can only ever show a cover
 * photo and a clipped description. Everything a property wrote about a room,
 * and every photo it uploaded, has to be reachable from somewhere, and this
 * is that somewhere. It also carries the choice, because a buyer who opened
 * a room to read about it is already deciding.
 */
describe("the details dialog", () => {
  const PHOTOGRAPHED = [
    room({
      images: [
        { id: "a", url: "https://example.test/a.jpg" },
        { id: "b", url: "https://example.test/b.jpg" },
        { id: "c", url: "https://example.test/c.jpg" },
      ],
      description: "A long description the board has no room for.",
    }),
  ]

  beforeEach(() => {
    listPortalAccommodations.mockResolvedValue({
      ...OFFER,
      accommodations: PHOTOGRAPHED,
      properties: [
        {
          id: "prop-1",
          name: "Casa del Lago",
          address: "Calle 12",
          description: "On the lake.",
        },
      ],
    })
    checkPortalAccommodationAvailability.mockResolvedValue([priced("studio")])
  })

  async function openDetails() {
    renderStep()
    await screen.findByText("Garden Studio")
    fireEvent.click(screen.getByRole("button", { name: "View details" }))
    return screen.getByRole("dialog")
  }

  it("says everything the card had to clip", async () => {
    const dialog = await openDetails()

    expect(
      within(dialog).getByText("A long description the board has no room for."),
    ).toBeTruthy()
    expect(within(dialog).getByText("On the lake.")).toBeTruthy()
    expect(within(dialog).getByText("Calle 12")).toBeTruthy()
  })

  it("carries every photo, not just the cover", async () => {
    const dialog = await openDetails()

    expect(within(dialog).getByText("1 of 3")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Next photo" }))
    expect(within(dialog).getByText("2 of 3")).toBeTruthy()
  })

  it("wraps round rather than dead-ending on the last photo", async () => {
    const dialog = await openDetails()

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Previous photo" }),
    )

    expect(within(dialog).getByText("3 of 3")).toBeTruthy()
  })

  it("lets the buyer decide without going back to the board", async () => {
    const dialog = await openDetails()

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Choose this room" }),
    )

    expect(addAccommodation).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
