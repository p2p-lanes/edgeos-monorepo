/**
 * Which door the accommodation step knocks on.
 *
 * There are two, and picking the wrong one fails in a way that reads like a
 * content problem rather than a routing one: the anonymous
 * `/checkout/{slug}/accommodations` refuses any popup that is not
 * `sale_type=direct`, the step swallows the error, and the buyer is told there
 * are no rooms. It shipped exactly that way once: the fetch branch was
 * written for the availability call and silently lost for the inventory one,
 * and type-checking could not tell, because both calls type-check fine.
 *
 * So this test asserts the routing itself, per flow, for both calls.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const listCheckoutAccommodations = vi.fn()
const listPortalAccommodations = vi.fn()
const checkAccommodationAvailability = vi.fn()
const checkPortalAccommodationAvailability = vi.fn()

vi.mock("@/client", () => ({
  CheckoutService: {
    listCheckoutAccommodations: (...args: unknown[]) =>
      listCheckoutAccommodations(...args),
    checkAccommodationAvailability: (...args: unknown[]) =>
      checkAccommodationAvailability(...args),
  },
  AccommodationsService: {
    listPortalAccommodations: (...args: unknown[]) =>
      listPortalAccommodations(...args),
    checkPortalAccommodationAvailability: (...args: unknown[]) =>
      checkPortalAccommodationAvailability(...args),
  },
}))

const checkoutValue = {
  cart: { accommodations: [] },
  addAccommodation: vi.fn(),
  removeAccommodation: vi.fn(),
  clearAccommodationsOutsideStay: vi.fn(),
  setAccommodationGuestCount: vi.fn(),
  setAccommodationGuestName: vi.fn(),
  previewToken: null as string | null,
  submitMode: "application" as "application" | "open-ticketing",
}

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => checkoutValue,
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => ({
      id: "popup-1",
      slug: "tech-summit-2025",
      currency: "USD",
    }),
  }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import VariantAccommodationBooking from "./VariantAccommodationBooking"

const ROOM = {
  id: "room-1",
  property_id: "prop-1",
  product_id: "shadow-1",
  name: "Habitacion Simple",
  kind: "room",
  description: null,
  guest_capacity: 2,
  beds: [{ type: "king", count: 1 }],
  default_nightly_price: "120.00",
  long_stay_price: null,
  min_stay: 2,
  bookable_from: "2026-08-25",
  bookable_to: "2026-08-31",
  images: [],
}

const OFFER = {
  properties: [{ id: "prop-1", name: "Hotel Arcadia" }],
  accommodations: [ROOM],
  currency: "USD",
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function renderStep() {
  return render(
    <VariantAccommodationBooking
      products={[]}
      stepType="housing"
      templateConfig={null}
    />,
    { wrapper },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  checkoutValue.submitMode = "application"
  checkoutValue.previewToken = null
  listCheckoutAccommodations.mockResolvedValue(OFFER)
  listPortalAccommodations.mockResolvedValue(OFFER)
  checkAccommodationAvailability.mockResolvedValue([])
  checkPortalAccommodationAvailability.mockResolvedValue([])
})

describe("VariantAccommodationBooking: which endpoint it calls", () => {
  it("uses the logged-in portal endpoints on an application popup", async () => {
    // The anonymous ones answer 403 for anything that is not direct-sale, so
    // this is the difference between a working step and "no rooms".
    renderStep()

    await waitFor(() => expect(listPortalAccommodations).toHaveBeenCalled())
    expect(listPortalAccommodations).toHaveBeenCalledWith({
      popupId: "popup-1",
    })
    expect(listCheckoutAccommodations).not.toHaveBeenCalled()

    await waitFor(() =>
      expect(checkPortalAccommodationAvailability).toHaveBeenCalled(),
    )
    expect(checkAccommodationAvailability).not.toHaveBeenCalled()
  })

  it("uses the anonymous endpoints on an open checkout", async () => {
    checkoutValue.submitMode = "open-ticketing"
    renderStep()

    await waitFor(() => expect(listCheckoutAccommodations).toHaveBeenCalled())
    expect(listCheckoutAccommodations).toHaveBeenCalledWith({
      slug: "tech-summit-2025",
      xCheckoutPreviewToken: undefined,
    })
    expect(listPortalAccommodations).not.toHaveBeenCalled()

    await waitFor(() =>
      expect(checkAccommodationAvailability).toHaveBeenCalled(),
    )
    expect(checkPortalAccommodationAvailability).not.toHaveBeenCalled()
  })

  it("passes the preview token only on the anonymous flow", async () => {
    // The portal endpoints authenticate the caller; a preview token there
    // would be meaningless, and the draft-popup preview is an open-checkout
    // concern.
    checkoutValue.submitMode = "open-ticketing"
    checkoutValue.previewToken = "preview-abc"
    renderStep()

    await waitFor(() => expect(listCheckoutAccommodations).toHaveBeenCalled())
    expect(listCheckoutAccommodations).toHaveBeenCalledWith({
      slug: "tech-summit-2025",
      xCheckoutPreviewToken: "preview-abc",
    })
  })

  it("asks for the shortest stay the inventory accepts, not one night", async () => {
    // This room has a two-night minimum: seeding one night would open the
    // step on "needs a longer stay" before showing a single price.
    renderStep()

    await waitFor(() =>
      expect(checkPortalAccommodationAvailability).toHaveBeenCalled(),
    )
    expect(checkPortalAccommodationAvailability).toHaveBeenCalledWith({
      popupId: "popup-1",
      requestBody: { check_in: "2026-08-25", check_out: "2026-08-27" },
    })
  })
})
