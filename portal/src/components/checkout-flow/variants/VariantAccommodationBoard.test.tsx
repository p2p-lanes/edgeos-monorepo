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
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

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
    fireEvent.click(screen.getByRole("button", { name: "Select" }))

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
      // Not getBy: the open sheet row prints the total in its header and
      // again in the detail it just revealed.
      expect(screen.getAllByText("$290").length).toBeGreaterThan(0)
      view.unmount()
    }
  })

  it("makes the whole card the control when it is cards", async () => {
    renderStep({ layout: "cards" })
    await screen.findByText("Garden Studio")

    const card = screen.getByRole("button", { pressed: false })
    fireEvent.click(card)

    expect(addAccommodation).toHaveBeenCalledTimes(1)
  })

  it("keeps the detail behind a disclosure when it is a sheet", async () => {
    renderStep({ layout: "sheet" })
    await screen.findByText("Garden Studio")

    // By name, not by state: the date pickers are Popover triggers and
    // carry aria-expanded of their own.
    const row = screen.getByRole("button", { name: /Garden Studio/ })
    expect(row.getAttribute("aria-expanded")).toBe("true")

    fireEvent.click(row)

    expect(
      screen
        .getByRole("button", { name: /Garden Studio/ })
        .getAttribute("aria-expanded"),
    ).toBe("false")
  })

  it("still understands the two names the step shipped with", async () => {
    // "grid" and "list" are stored on steps nobody has edited since the
    // rename, and the backend only renames them when the step is saved.
    renderStep({ layout: "grid" })
    await screen.findByText("Garden Studio")

    expect(screen.getByRole("button", { pressed: false })).toBeTruthy()
  })
})
