import { fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import Home from "./page"

const mocks = vi.hoisted(() => ({
  access: { state: "denied" } as {
    state: "allowed" | "denied"
    source?: "attendee"
  },
  city: {
    id: "popup-1",
    slug: "my-event",
    status: "active",
    takes_applications: false,
  } as {
    id: string
    slug: string
    status: string
    takes_applications: boolean
  } | null,
  doors: [] as Array<{ flowId: string }>,
  doorsLoading: false,
  doorsError: false,
  participation: null as { type: string } | null,
  directFlows: [] as Array<{ id: string; slug: string; name: string }>,
  push: vi.fn(),
  replace: vi.fn(),
  search: "",
  getRelevantApplication: vi.fn(),
  feeBanner: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => mocks.city, popupsLoaded: true }),
}))

vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    getRelevantApplication: mocks.getRelevantApplication,
    participation: mocks.participation,
  }),
}))

vi.mock("@/hooks/useGatheringDoors", () => ({
  useGatheringDoors: () => ({
    doors: mocks.doors,
    isLoading: mocks.doorsLoading,
    isError: mocks.doorsError,
  }),
}))

vi.mock("@/hooks/usePortalDirectSalesFlows", () => ({
  usePortalDirectSalesFlows: () => ({ data: mocks.directFlows }),
}))

vi.mock("@/hooks/useHumanPopupAccess", () => ({
  useHumanPopupAccess: () => mocks.access,
}))

vi.mock("@/components/Card/EventCard", () => {
  const EventCard = Object.assign(
    ({ children }: { children: ReactNode }) => (
      <div data-testid="event-card">{children}</div>
    ),
    {
      Image: () => null,
      Content: ({ children }: { children: ReactNode }) => <div>{children}</div>,
      Title: () => null,
      Tagline: () => null,
      Location: () => null,
      DateRange: () => null,
      Progress: () => <div data-testid="application-progress" />,
      ApplyButton: ({
        onClick,
        labelKey,
      }: {
        onClick: () => void
        labelKey?: string
      }) => (
        <button type="button" onClick={onClick}>
          {labelKey ?? "Apply"}
        </button>
      ),
    },
  )
  return { EventCard }
})

vi.mock("@/components/Portal/GatheringDoorCard", () => ({
  GatheringDoorCard: () => <div data-testid="application-door" />,
}))

vi.mock("@/components/CompanionView", () => ({
  CompanionView: () => <div data-testid="companion-view" />,
}))

vi.mock("@/components/ScholarshipStatusBadge", () => ({
  ScholarshipStatusBadge: () => null,
}))

vi.mock("./application/components/fee-payment-banner", () => ({
  FeePaymentBanner: (props: {
    application: { id: string }
    isReturnFromCheckout: boolean
  }) => {
    mocks.feeBanner(props)
    return <div data-testid="fee-banner" />
  },
}))

vi.mock("@/components/ui/Loader", () => ({
  Loader: () => <div data-testid="loader" />,
}))

describe("portal event overview", () => {
  beforeEach(() => {
    mocks.access = { state: "denied" }
    mocks.city = {
      id: "popup-1",
      slug: "my-event",
      status: "active",
      takes_applications: false,
    }
    mocks.doors = []
    mocks.doorsLoading = false
    mocks.doorsError = false
    mocks.participation = null
    mocks.directFlows = []
    mocks.push.mockClear()
    mocks.replace.mockClear()
    mocks.search = ""
    mocks.getRelevantApplication.mockReset().mockReturnValue(null)
    mocks.feeBanner.mockClear()
  })

  it.each([
    1, 2,
  ])("links assigned ticket holders to passes without an application across %i flows", (flowCount) => {
    if (mocks.city) mocks.city.takes_applications = true
    mocks.doors = Array.from({ length: flowCount }, (_, index) => ({
      flowId: `application-${index}`,
    }))
    mocks.access = { state: "allowed", source: "attendee" }

    render(<Home />)

    fireEvent.click(screen.getByRole("button", { name: "cta.accepted" }))
    expect(mocks.push).toHaveBeenCalledWith("/portal/my-event/passes")
    expect(screen.queryByTestId("application-progress")).toBeNull()
  })

  it.each([
    "loading",
    "error",
  ])("keeps assigned tickets reachable when flow discovery is %s", (state) => {
    if (mocks.city) mocks.city.takes_applications = true
    mocks.access = { state: "allowed", source: "attendee" }
    mocks.doorsLoading = state === "loading"
    mocks.doorsError = state === "error"

    render(<Home />)

    fireEvent.click(screen.getByRole("button", { name: "cta.accepted" }))
    expect(mocks.push).toHaveBeenCalledWith("/portal/my-event/passes")
  })

  it("shows the existing Buy Tickets CTA for a portal-listed direct flow", () => {
    mocks.directFlows = [{ id: "flow-1", slug: "checkout", name: "Checkout" }]

    render(<Home />)

    fireEvent.click(screen.getByRole("button", { name: "cta.buy_tickets" }))
    expect(mocks.push).toHaveBeenCalledWith("/checkout/my-event/checkout")
  })

  it("hides the Buy Tickets CTA when no direct flow is portal-listed", () => {
    render(<Home />)

    expect(screen.queryByRole("button", { name: "cta.buy_tickets" })).toBeNull()
  })

  it("redirects an invisible popup slug to the portal root after loading", () => {
    mocks.city = null

    render(<Home />)

    expect(mocks.replace).toHaveBeenCalledWith("/portal")
    expect(screen.queryByTestId("application-door")).toBeNull()
  })

  it("does not mount direct sales alongside multiple application options", () => {
    if (mocks.city) mocks.city.takes_applications = true
    mocks.doors = [{ flowId: "application-1" }, { flowId: "application-2" }]

    render(<Home />)

    expect(screen.getAllByTestId("application-door")).toHaveLength(2)
  })

  it("shows only the canonical loader while application flows are unresolved", () => {
    if (mocks.city) mocks.city.takes_applications = true
    mocks.doorsLoading = true

    render(<Home />)

    expect(screen.getByTestId("loader")).toBeTruthy()
    expect(screen.queryByTestId("event-card")).toBeNull()
    expect(screen.queryByTestId("application-door")).toBeNull()
  })

  it("renders the existing application error treatment after query failure", () => {
    if (mocks.city) mocks.city.takes_applications = true
    mocks.doorsError = true

    render(<Home />)

    expect(screen.getByText("application.unavailable")).toBeTruthy()
    expect(screen.queryByTestId("loader")).toBeNull()
    expect(screen.queryByTestId("event-card")).toBeNull()
  })

  it("waits for participation before choosing the companion layout", () => {
    if (mocks.city) mocks.city.takes_applications = true
    mocks.doorsLoading = true

    const { rerender } = render(<Home />)

    expect(screen.getByTestId("loader")).toBeTruthy()
    expect(screen.queryByTestId("event-card")).toBeNull()

    mocks.participation = { type: "companion" }
    mocks.doorsLoading = false
    rerender(<Home />)

    expect(screen.getByTestId("companion-view")).toBeTruthy()
    expect(screen.queryByTestId("event-card")).toBeNull()
  })

  it("renders the multi-flow overview after flow discovery settles", () => {
    if (mocks.city) mocks.city.takes_applications = true
    mocks.doors = [{ flowId: "application-1" }, { flowId: "application-2" }]

    render(<Home />)

    expect(screen.queryByTestId("loader")).toBeNull()
    expect(screen.getAllByTestId("application-door")).toHaveLength(2)
    expect(screen.queryByTestId("application-progress")).toBeNull()
  })

  it("preserves the legacy application layout after one flow settles", () => {
    if (mocks.city) mocks.city.takes_applications = true
    mocks.doors = [{ flowId: "application-1" }]

    render(<Home />)

    expect(screen.queryByTestId("loader")).toBeNull()
    expect(screen.queryByTestId("application-door")).toBeNull()
    expect(screen.getByTestId("application-progress")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy()
  })

  it.each([
    1, 2,
  ])("shows fee confirmation alongside the overview with %i application flows", (flowCount) => {
    if (mocks.city) mocks.city.takes_applications = true
    mocks.doors = Array.from({ length: flowCount }, (_, index) => ({
      flowId: `flow-${index + 1}`,
    }))
    const flowId = `flow-${flowCount}`
    const application = {
      id: "paid-application",
      sales_flow_id: flowId,
      status: "pending_fee",
    }
    mocks.search = `flow=${flowId}&checkout=success`
    mocks.getRelevantApplication.mockImplementation((selectedFlow?: string) =>
      selectedFlow === flowId ? application : null,
    )

    render(<Home />)

    expect(screen.getByTestId("event-card")).toBeTruthy()
    expect(screen.getByTestId("fee-banner")).toBeTruthy()
    expect(mocks.feeBanner).toHaveBeenCalledWith({
      application,
      isReturnFromCheckout: true,
    })
    if (flowCount > 1) {
      expect(screen.getAllByTestId("application-door")).toHaveLength(flowCount)
    }
  })

  it.each([
    "",
    "flow=flow-1",
    "checkout=success",
    "flow=flow-1&checkout=cancel",
  ])("does not confirm an application without a flow-scoped fee success: %s", (search) => {
    if (mocks.city) mocks.city.takes_applications = true
    mocks.search = search
    mocks.getRelevantApplication.mockReturnValue({
      id: "unrelated-application",
      status: "pending_fee",
    })

    render(<Home />)

    expect(screen.queryByTestId("fee-banner")).toBeNull()
    expect(mocks.feeBanner).not.toHaveBeenCalled()
  })

  it("does not fall back to another application for an unknown fee flow", () => {
    if (mocks.city) mocks.city.takes_applications = true
    mocks.search = "flow=unknown&checkout=success"
    mocks.getRelevantApplication.mockImplementation((flowId?: string) =>
      flowId ? null : { id: "other-application", status: "pending_fee" },
    )

    render(<Home />)

    expect(screen.getByTestId("event-card")).toBeTruthy()
    expect(screen.queryByTestId("fee-banner")).toBeNull()
  })

  it("does not mount direct sales for a companion overview", () => {
    if (mocks.city) mocks.city.takes_applications = true
    mocks.participation = { type: "companion" }

    render(<Home />)

    expect(screen.getByTestId("companion-view")).toBeTruthy()
  })
})
