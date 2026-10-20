import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import ProfileCompletionReminder from "./ProfileCompletionReminder"

const mocks = vi.hoisted(() => ({
  profile: {
    first_name: null as string | null,
    last_name: null as string | null,
  },
  profileLoading: false,
  hasTicket: vi.fn(),
  popup: { id: "popup-1" },
}))

vi.mock("@/client", () => ({
  HumansService: { hasCurrentHumanActiveTicket: mocks.hasTicket },
}))
vi.mock("@/hooks/useGetProfile", () => ({
  default: () => ({ profile: mocks.profile, isLoading: mocks.profileLoading }),
}))
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => mocks.popup }),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function renderReminder() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <ProfileCompletionReminder />
    </QueryClientProvider>
  )
  const view = render(tree())
  return { ...view, rerenderWithProvider: () => view.rerender(tree()) }
}

afterEach(() => {
  cleanup()
  mocks.profile = { first_name: null, last_name: null }
  mocks.profileLoading = false
  mocks.hasTicket.mockReset()
  mocks.popup = { id: "popup-1" }
})

describe("ProfileCompletionReminder", () => {
  it("stays hidden for a new user without a ticket", () => {
    mocks.hasTicket.mockResolvedValue(false)
    renderReminder()
    expect(screen.queryByText("portal.complete_profile_title")).toBeNull()
  })

  it("appears when the human has a ticket and the name is incomplete", async () => {
    mocks.hasTicket.mockResolvedValue(true)
    renderReminder()
    expect(
      await screen.findByText("portal.complete_profile_title"),
    ).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "portal.complete_profile_action" })
        .getAttribute("href"),
    ).toBe("/portal/profile")
    expect(mocks.hasTicket).toHaveBeenCalledWith({ popupId: "popup-1" })
  })

  it("stays hidden once first and last name are present", () => {
    mocks.profile = { first_name: "Taylor", last_name: "Test" }
    mocks.hasTicket.mockResolvedValue(true)
    renderReminder()
    expect(screen.queryByText("portal.complete_profile_title")).toBeNull()
  })

  it("rechecks ticket ownership when the active popup changes", async () => {
    mocks.hasTicket.mockImplementation(({ popupId }: { popupId: string }) =>
      Promise.resolve(popupId === "popup-1"),
    )
    const { rerenderWithProvider } = renderReminder()
    expect(
      await screen.findByText("portal.complete_profile_title"),
    ).toBeTruthy()

    mocks.popup = { id: "popup-2" }
    rerenderWithProvider()
    await waitFor(() =>
      expect(screen.queryByText("portal.complete_profile_title")).toBeNull(),
    )
    expect(
      screen.queryByRole("link", { name: "portal.complete_profile_action" }),
    ).toBeNull()
  })
})
