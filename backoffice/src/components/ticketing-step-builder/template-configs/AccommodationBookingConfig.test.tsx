/**
 * The accommodation step's config panel.
 *
 * Two things matter here and neither is cosmetic. First, the keys it writes
 * are read positionally out of untyped JSON by the portal *and* by the
 * backend gate that decides whether an accommodation line may be purchased at
 * all: a silent rename would let a room be sold from a step that no longer
 * offers it. Second, this panel must never edit inventory: rooms, prices and
 * the calendar live in the Accommodations section, and duplicating them here
 * is exactly the confusion the step/section split exists to prevent.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const listProperties = vi.fn()

vi.mock("@/client", () => ({
  AccommodationsService: {
    listProperties: (...args: unknown[]) => listProperties(...args),
  },
}))

import { AccommodationBookingConfig } from "./AccommodationBookingConfig"
import { TEMPLATE_CONFIG_REGISTRY } from "./index"

const PROPERTY_A = {
  id: "prop-a",
  name: "Hotel Arcadia",
  address: "12 Lake Road",
  is_active: true,
}
const PROPERTY_B = {
  id: "prop-b",
  name: "Cabañas del Lago",
  address: null,
  is_active: true,
}

function renderConfig(config: Record<string, unknown> | null = null) {
  const onChange = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <AccommodationBookingConfig
        config={config}
        onChange={onChange}
        popupId="popup-1"
        productCategory={null}
      />
    </QueryClientProvider>,
  )
  return onChange
}

describe("AccommodationBookingConfig", () => {
  beforeEach(() => {
    listProperties.mockReset()
    listProperties.mockResolvedValue({
      results: [PROPERTY_A, PROPERTY_B],
      paging: { offset: 0, limit: 2, total: 2 },
    })
  })

  it("is wired into the config registry", () => {
    expect(TEMPLATE_CONFIG_REGISTRY["accommodation-booking"]).toBe(
      AccommodationBookingConfig,
    )
  })

  it("lists the gathering's properties without offering to edit them", async () => {
    renderConfig({})

    await waitFor(() => {
      expect(screen.getByText("Hotel Arcadia")).toBeTruthy()
    })
    expect(screen.getByText("Cabañas del Lago")).toBeTruthy()
    expect(listProperties).toHaveBeenCalledWith({ popupId: "popup-1" })

    // No inventory controls: this panel decides what is offered, not what
    // exists. No price/capacity inputs, no way to add a room, only a pointer
    // to where that actually lives.
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0)
    expect(screen.queryByText(/Add room/i)).toBeNull()
    expect(screen.getByText(/Manage accommodations/)).toBeTruthy()
  })

  it("treats an empty selection as 'every property is offered'", async () => {
    renderConfig({ property_ids: [] })

    await waitFor(() => {
      expect(
        screen.getByText("Nothing selected. Every visible property is offered."),
      ).toBeTruthy()
    })
  })

  it("adds a property to the subset without dropping the rest of the config", async () => {
    const onChange = renderConfig({ layout: "list", property_ids: ["prop-b"] })

    await waitFor(() => {
      expect(screen.getByText("Hotel Arcadia")).toBeTruthy()
    })
    fireEvent.click(screen.getAllByRole("checkbox")[0])

    const next = onChange.mock.calls[0][0]
    expect(next.property_ids).toEqual(["prop-b", "prop-a"])
    expect(next.layout).toBe("list")
  })

  it("removes a property from the subset", async () => {
    const onChange = renderConfig({ property_ids: ["prop-a", "prop-b"] })

    await waitFor(() => {
      expect(screen.getByText("Hotel Arcadia")).toBeTruthy()
    })
    fireEvent.click(screen.getAllByRole("checkbox")[0])

    expect(onChange.mock.calls[0][0].property_ids).toEqual(["prop-b"])
  })

  it("writes the layout key the portal and the backend read", async () => {
    const onChange = renderConfig({ property_ids: ["prop-a"] })

    await waitFor(() => {
      expect(screen.getByText("Hotel Arcadia")).toBeTruthy()
    })
    fireEvent.click(screen.getByRole("button", { name: /Presentation/ }))
    fireEvent.click(screen.getByRole("button", { name: /^List/ }))

    const next = onChange.mock.calls[0][0]
    expect(next.layout).toBe("list")
    expect(next.property_ids).toEqual(["prop-a"])
  })

  it("defaults both switches to on and can turn them off", async () => {
    const onChange = renderConfig({})

    await waitFor(() => {
      expect(screen.getByText("Hotel Arcadia")).toBeTruthy()
    })
    fireEvent.click(screen.getByRole("button", { name: /Presentation/ }))
    const switches = screen.getAllByRole("switch")
    expect(switches.every((s) => s.getAttribute("data-state") === "checked")).toBe(
      true,
    )

    fireEvent.click(switches[1])
    expect(onChange.mock.calls[0][0].require_guest_names).toBe(false)
  })

  it("stores the payment notice copy", async () => {
    const onChange = renderConfig({})

    await waitFor(() => {
      expect(screen.getByText("Hotel Arcadia")).toBeTruthy()
    })
    fireEvent.click(screen.getByRole("button", { name: /Payment notice/ }))
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Se abona el total por adelantado." },
    })

    expect(onChange.mock.calls[0][0].notice_text).toBe(
      "Se abona el total por adelantado.",
    )
  })

  it("shows an empty state pointing at the inventory section", async () => {
    listProperties.mockResolvedValue({
      results: [],
      paging: { offset: 0, limit: 0, total: 0 },
    })
    renderConfig({})

    await waitFor(() => {
      expect(screen.getByText("No accommodation yet")).toBeTruthy()
    })
    expect(screen.getByText("Add the first property")).toBeTruthy()
  })
})
