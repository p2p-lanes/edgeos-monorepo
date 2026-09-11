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

  it("says an empty selection offers everything, rather than implying none", async () => {
    // The bug this replaced: a column of unticked boxes reads as "I have
    // chosen nothing", and the checkout then offered every property. An
    // empty subset is how the backend stores "everything", so the panel has
    // to say which of the two it means.
    renderConfig({ property_ids: [] })

    await waitFor(() => {
      expect(screen.getByText("Hotel Arcadia")).toBeTruthy()
    })
    expect(
      screen
        .getByRole("button", { name: /^Every property/ })
        .getAttribute("aria-pressed"),
    ).toBe("true")
    // The names stay on screen: "every property" is a claim about them.
    expect(screen.getByText("Cabañas del Lago")).toBeTruthy()
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
  })

  it("offers the boxes only once the operator says 'only some'", async () => {
    const onChange = renderConfig({ property_ids: [] })

    await waitFor(() => {
      expect(screen.getByText("Hotel Arcadia")).toBeTruthy()
    })
    fireEvent.click(screen.getByRole("button", { name: /^Only some/ }))

    expect(screen.queryAllByRole("checkbox")).toHaveLength(2)
    // Nothing is written yet: opening the picker is not a decision.
    expect(onChange).not.toHaveBeenCalled()
    // And while nothing is ticked it still means everything, so it says so.
    expect(screen.getByText(/still offers every property/)).toBeTruthy()
  })

  it("goes back to everything by clearing the subset", async () => {
    const onChange = renderConfig({ property_ids: ["prop-a"] })

    await waitFor(() => {
      expect(screen.getByText("Hotel Arcadia")).toBeTruthy()
    })
    fireEvent.click(screen.getByRole("button", { name: /^Every property/ }))

    expect(onChange.mock.calls[0][0].property_ids).toEqual([])
  })

  it("adds a property to the subset without dropping the rest of the config", async () => {
    const onChange = renderConfig({ layout: "sheet", property_ids: ["prop-b"] })

    await waitFor(() => {
      expect(screen.getByText("Hotel Arcadia")).toBeTruthy()
    })
    fireEvent.click(screen.getAllByRole("checkbox")[0])

    const next = onChange.mock.calls[0][0]
    expect(next.property_ids).toEqual(["prop-b", "prop-a"])
    expect(next.layout).toBe("sheet")
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
    fireEvent.click(screen.getByRole("button", { name: /^Sheet/ }))

    const next = onChange.mock.calls[0][0]
    expect(next.layout).toBe("sheet")
    expect(next.property_ids).toEqual(["prop-a"])
  })

  it("lights up the right option for a step saved under the old names", async () => {
    // "grid" and "list" are what the first two layouts were called. The
    // backend renames them on save, but until someone saves this step it
    // still answers with the old name, and the picker has to cope.
    renderConfig({ layout: "grid" })

    await waitFor(() => {
      expect(screen.getByText("Hotel Arcadia")).toBeTruthy()
    })
    fireEvent.click(screen.getByRole("button", { name: /Presentation/ }))

    expect(
      screen
        .getByRole("button", { name: /^Cards/ })
        .getAttribute("aria-pressed"),
    ).toBe("true")
    expect(
      screen
        .getByRole("button", { name: /^Rows/ })
        .getAttribute("aria-pressed"),
    ).toBe("false")
  })

  it("defaults grouping to on and can turn it off", async () => {
    const onChange = renderConfig({})

    await waitFor(() => {
      expect(screen.getByText("Hotel Arcadia")).toBeTruthy()
    })
    fireEvent.click(screen.getByRole("button", { name: /Presentation/ }))
    const grouping = screen.getByRole("switch")
    expect(grouping.getAttribute("data-state")).toBe("checked")

    fireEvent.click(grouping)
    expect(onChange.mock.calls[0][0].show_property_headers).toBe(false)
  })

  it("keeps the name switch with the rest of what guests are asked", async () => {
    // It moved out of Presentation: it answers the same question as the
    // guest form below it, and an operator deciding what to ask should not
    // have to find half of it under a layout heading.
    const onChange = renderConfig({})

    await waitFor(() => {
      expect(screen.getByText("Hotel Arcadia")).toBeTruthy()
    })
    fireEvent.click(screen.getByRole("button", { name: /Guest details/ }))
    const names = screen.getByRole("switch")
    expect(names.getAttribute("data-state")).toBe("checked")

    fireEvent.click(names)
    expect(onChange.mock.calls[0][0].require_guest_names).toBe(false)
  })

  it("writes a picked preset into template_config.guest_form", async () => {
    // The wiring, not the editor: the editor has its own tests. What this
    // pins is that what it hands back lands under the key the backend
    // validates and the portal reads.
    const onChange = renderConfig({})

    await waitFor(() => {
      expect(screen.getByText("Hotel Arcadia")).toBeTruthy()
    })
    fireEvent.click(screen.getByRole("button", { name: /Guest details/ }))
    fireEvent.click(screen.getByRole("button", { name: /A phone number/ }))

    const form = onChange.mock.calls[0][0].guest_form
    expect(form.booker.fields.map((f: { key: string }) => f.key)).toEqual([
      "phone",
    ])
    expect(form.guests.mode).toBe("same_as_booker")
  })

  it("stores no form at all when the operator asks nothing", async () => {
    // "Start from scratch" opens an empty editor. An empty form is stored as
    // null rather than as a shape with two empty sections, so the checkout
    // has one thing to check instead of three.
    const onChange = renderConfig({})

    await waitFor(() => {
      expect(screen.getByText("Hotel Arcadia")).toBeTruthy()
    })
    fireEvent.click(screen.getByRole("button", { name: /Guest details/ }))
    fireEvent.click(screen.getByRole("button", { name: /Start from scratch/ }))

    expect(onChange.mock.calls[0][0].guest_form).toBeNull()
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
