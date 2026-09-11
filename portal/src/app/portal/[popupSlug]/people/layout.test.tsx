import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import PeopleLayout from "./layout"

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  mountPage: vi.fn(),
  city: {
    id: "popup-1",
    slug: "summit",
    status: "active",
    takes_applications: true,
  } as {
    id: string
    slug: string
    status: string
    takes_applications: boolean
  } | null,
  user: { id: "human-1" } as { id: string } | null,
  authLoading: false,
  applicationLoading: false,
  participationLoading: false,
  applicationError: false,
  participationError: false,
  applicationStatus: null as string | null,
  participation: null as { type: string; application_status: string } | null,
  endedState: "denied",
  flow: "",
  selectedFlow: null as string | null,
}))

vi.mock("next/navigation", () => ({
  useParams: () => ({ popupSlug: "summit" }),
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () =>
    new URLSearchParams(mocks.flow ? { flow: mocks.flow } : {}),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock("@/components/ui/Loader", () => ({
  Loader: () => <output>Loading</output>,
}))
vi.mock("@/hooks/useAuth", () => ({
  default: () => ({ user: mocks.user, isUserLoading: mocks.authLoading }),
}))
vi.mock("@/hooks/useGetApplications", () => ({
  useApplicationsQuery: () => ({
    isLoading: mocks.applicationLoading,
    isError: mocks.applicationError,
  }),
}))
vi.mock("@/hooks/useParticipationQuery", () => ({
  useParticipationQuery: () => ({
    isLoading: mocks.participationLoading,
    isError: mocks.participationError,
  }),
}))
vi.mock("@/hooks/useHumanPopupAccess", () => ({
  useHumanPopupAccess: () => ({ state: mocks.endedState }),
}))
vi.mock("@/hooks/useGatheringDoors", () => ({
  useGatheringDoors: () => ({ doors: [] }),
}))
vi.mock("@/hooks/usePortalSalesFlows", () => ({
  usePortalSalesFlows: () => ({ data: [] }),
}))
vi.mock("@/hooks/usePortalDirectSalesFlows", () => ({
  usePortalDirectSalesFlows: () => ({ data: [] }),
}))
vi.mock("@/hooks/usePortalUpsaleFlows", () => ({
  usePortalUpsaleFlows: () => ({ data: [] }),
}))
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => mocks.city }),
}))
vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    getRelevantApplication: (flow: string | null) => {
      mocks.selectedFlow = flow
      return mocks.applicationStatus
        ? { status: mocks.applicationStatus }
        : null
    },
    participation: mocks.participation,
  }),
}))

// Keep useResources real: route tests must exercise the same policy as the sidebar.
function Page() {
  mocks.mountPage()
  return <div>You & companions content</div>
}
const renderPage = () =>
  render(
    <PeopleLayout>
      <Page />
    </PeopleLayout>,
  )

function expectBlocked() {
  expect(screen.queryByText("You & companions content")).toBeNull()
  expect(mocks.mountPage).not.toHaveBeenCalled()
}

function expectAllowed() {
  expect(screen.getByText("You & companions content")).toBeTruthy()
  expect(mocks.replace).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.city = {
    id: "popup-1",
    slug: "summit",
    status: "active",
    takes_applications: true,
  }
  mocks.user = { id: "human-1" }
  mocks.authLoading = false
  mocks.applicationLoading = false
  mocks.participationLoading = false
  mocks.applicationError = false
  mocks.participationError = false
  mocks.applicationStatus = null
  mocks.participation = null
  mocks.endedState = "denied"
  mocks.flow = ""
  mocks.selectedFlow = null
})

describe("You & companions route access", () => {
  it.each([
    null,
    "draft",
    "pending_fee",
    "in review",
    "rejected",
    "withdrawn",
  ])("redirects a direct URL visit with application status %s without mounting the page", (status) => {
    mocks.applicationStatus = status
    renderPage()
    expectBlocked()
    expect(mocks.replace).toHaveBeenCalledWith("/portal/summit")
  })

  it("allows an accepted applicant even when nothing is currently for sale", () => {
    mocks.applicationStatus = "accepted"
    renderPage()
    expectAllowed()
  })

  it.each([
    "accepted",
    "in review",
  ])("preserves companion access with application status %s", (status) => {
    mocks.participation = { type: "companion", application_status: status }
    renderPage()
    expectAllowed()
  })

  it("preserves signed-in access for events without applications", () => {
    mocks.city!.takes_applications = false
    renderPage()
    expectAllowed()
  })

  it("does not mount the page for an anonymous visitor", () => {
    mocks.city!.takes_applications = false
    mocks.user = null
    renderPage()
    expectBlocked()
    expect(mocks.replace).toHaveBeenCalledWith("/portal/summit")
  })

  it.each([
    "authLoading",
    "applicationLoading",
    "participationLoading",
  ] as const)("waits for %s before redirecting or rendering content", (key) => {
    mocks[key] = true
    const view = renderPage()
    expectBlocked()
    expect(mocks.replace).not.toHaveBeenCalled()
    mocks[key] = false
    mocks.applicationStatus = "accepted"
    view.rerender(
      <PeopleLayout>
        <Page />
      </PeopleLayout>,
    )
    expectAllowed()
  })

  it("waits for the popup to resolve", () => {
    mocks.city = null
    renderPage()
    expectBlocked()
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it.each([
    "applicationError",
    "participationError",
  ] as const)("fails closed on %s even with cached approval", (key) => {
    mocks.applicationStatus = "accepted"
    mocks[key] = true
    renderPage()
    expectBlocked()
    expect(mocks.replace).toHaveBeenCalledWith("/portal/summit")
  })

  it.each([
    "allowed",
    "denied",
    "loading",
  ])("honors ended-event access: %s", (state) => {
    mocks.city!.status = "ended"
    mocks.city!.takes_applications = false
    mocks.endedState = state
    renderPage()
    if (state === "allowed") expectAllowed()
    else {
      expectBlocked()
      if (state === "loading") expect(mocks.replace).not.toHaveBeenCalled()
      else expect(mocks.replace).toHaveBeenCalledWith("/portal/summit")
    }
  })

  it("keeps the selected flow when allowing an accepted application", () => {
    mocks.flow = "volunteer"
    mocks.applicationStatus = "accepted"
    renderPage()
    expectAllowed()
    expect(mocks.selectedFlow).toBe("volunteer")
  })

  it("keeps the selected flow on denial", () => {
    mocks.flow = "general-entry"
    renderPage()
    expectBlocked()
    expect(mocks.replace).toHaveBeenCalledWith(
      "/portal/summit?flow=general-entry",
    )
  })
})
