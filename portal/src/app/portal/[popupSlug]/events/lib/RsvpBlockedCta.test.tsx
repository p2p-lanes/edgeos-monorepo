import { fireEvent, render, screen } from "@testing-library/react"
import { RsvpBlockedCta } from "./RsvpBlockedCta"
import { buildBuyTicketsHref } from "./useBuyTicketsHref"

const mockBuyHref = vi.fn<() => string | null>()

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// Only the hook is stubbed; `buildBuyTicketsHref` stays real so its own
// assertions below exercise the shipped implementation.
vi.mock("./useBuyTicketsHref", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useBuyTicketsHref")>()
  return { ...actual, useBuyTicketsHref: () => mockBuyHref() }
})

function DisabledRsvpButton() {
  return (
    <button type="button" disabled>
      RSVP
    </button>
  )
}

beforeEach(() => {
  mockBuyHref.mockReset()
  mockBuyHref.mockReturnValue("/portal/edge-city/shop/general")
})

describe("buildBuyTicketsHref", () => {
  it("points at the resolved shop flow when there is exactly one door", () => {
    expect(buildBuyTicketsHref("edge-city", "general")).toBe(
      "/portal/edge-city/shop/general",
    )
  })

  it("falls back to the passes hub when the flow is ambiguous", () => {
    expect(buildBuyTicketsHref("edge-city", null)).toBe(
      "/portal/edge-city/passes",
    )
  })

  it("resolves to nothing without a popup in context", () => {
    expect(buildBuyTicketsHref(undefined, "general")).toBeNull()
    expect(buildBuyTicketsHref(null, null)).toBeNull()
  })
})

describe("RsvpBlockedCta", () => {
  it("renders the button untouched when RSVP is not blocked", () => {
    render(
      <RsvpBlockedCta reason={null}>
        <DisabledRsvpButton />
      </RsvpBlockedCta>,
    )

    expect(screen.queryByRole("button", { name: /why_blocked/ })).toBeNull()
  })

  it("does not offer to sell a ticket to a rejected applicant", () => {
    render(
      <RsvpBlockedCta reason="rejected" message="rejected copy">
        <DisabledRsvpButton />
      </RsvpBlockedCta>,
    )

    expect(screen.queryByRole("button", { name: /why_blocked/ })).toBeNull()
    expect(screen.queryByText("cta.buy_tickets")).toBeNull()
  })

  it("opens a tappable purchase CTA when the blocker is a missing ticket", () => {
    render(
      <RsvpBlockedCta reason="no_tickets" message="needs a ticket">
        <DisabledRsvpButton />
      </RsvpBlockedCta>,
    )

    const trigger = screen.getByRole("button", {
      name: "events.rsvp.why_blocked",
    })
    expect(screen.queryByText("cta.buy_tickets")).toBeNull()

    fireEvent.click(trigger)

    expect(screen.getByText("needs a ticket")).toBeTruthy()
    const link = screen.getByRole("link", { name: /cta.buy_tickets/ })
    expect(link.getAttribute("href")).toBe("/portal/edge-city/shop/general")
  })

  it("keeps the explanation when no purchase destination resolves", () => {
    mockBuyHref.mockReturnValue(null)
    render(
      <RsvpBlockedCta reason="no_tickets" message="needs a ticket">
        <DisabledRsvpButton />
      </RsvpBlockedCta>,
    )

    fireEvent.click(
      screen.getByRole("button", { name: "events.rsvp.why_blocked" }),
    )

    expect(screen.getByText("needs a ticket")).toBeTruthy()
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("stops the click from reaching a surrounding event-card link", () => {
    const onLinkClick = vi.fn()
    render(
      // biome-ignore lint/a11y/useKeyWithClickEvents: stand-in for the real <Link> wrapper
      // biome-ignore lint/a11y/noStaticElementInteractions: stand-in for the real <Link> wrapper
      <div onClick={onLinkClick}>
        <RsvpBlockedCta reason="no_tickets" message="needs a ticket">
          <DisabledRsvpButton />
        </RsvpBlockedCta>
      </div>,
    )

    fireEvent.click(
      screen.getByRole("button", { name: "events.rsvp.why_blocked" }),
    )

    expect(onLinkClick).not.toHaveBeenCalled()
  })

  it("closes again when the trigger is tapped a second time", () => {
    render(
      <RsvpBlockedCta reason="no_tickets" message="needs a ticket">
        <DisabledRsvpButton />
      </RsvpBlockedCta>,
    )

    const trigger = screen.getByRole("button", {
      name: "events.rsvp.why_blocked",
    })

    fireEvent.click(trigger)
    expect(screen.getByText("needs a ticket")).toBeTruthy()

    // Tapping the trigger again is the first thing a touch user reaches for,
    // and there is no PopoverTrigger to handle it, so the wrapper has to
    // toggle rather than re-open what Radix just dismissed.
    fireEvent.click(trigger)
    expect(screen.queryByText("needs a ticket")).toBeNull()
  })
})
