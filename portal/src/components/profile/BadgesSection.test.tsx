import "@/i18n/config"

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { toast } from "sonner"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import BadgesSection from "./BadgesSection"

const state = vi.hoisted(() => ({
  enabled: false,
  pending: false,
  mobile: false,
  mutate: vi.fn(),
  copy: vi.fn(),
}))

vi.mock("@/hooks/useMyBadges", () => ({
  default: () => ({ badges: [], isLoading: false }),
}))

vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => state.mobile,
}))

vi.mock("@/hooks/usePublicProfileSettings", () => ({
  default: () => ({
    settings: { enabled: state.enabled, token: "fixture-public-link" },
    setEnabled: { isPending: state.pending, mutate: state.mutate },
  }),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
  state.enabled = false
  state.pending = false
  state.mobile = false
  state.mutate.mockReset()
  state.copy.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: state.copy },
  })
})

afterEach(cleanup)

function openSharing() {
  const trigger = screen.getByRole("button", { name: "Share" })
  trigger.focus()
  fireEvent.click(trigger)
  return within(screen.getByRole("dialog", { name: "Share my badges" }))
}

describe.each([
  { label: "desktop popover", mobile: false },
  { label: "mobile dialog", mobile: true },
])("BadgesSection sharing: $label", ({ mobile }) => {
  beforeEach(() => {
    state.mobile = mobile
  })

  it("keeps only Share beside the title, with no inline settings or URL", () => {
    state.enabled = true
    render(<BadgesSection />)

    const heading = screen.getByRole("heading", { name: "My badges", level: 2 })
    const trigger = screen.getByRole("button", { name: "Share" })
    expect(heading.parentElement?.parentElement?.contains(trigger)).toBe(true)
    expect(screen.getAllByRole("button").length).toBe(1)
    expect(screen.queryByRole("switch")).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull()
    expect(document.querySelector("code")).toBeNull()
    expect(document.body.textContent).not.toContain("fixture-public-link")
    const emptyCollection = screen.getByText(
      "No badges yet. They show up here when someone gives you one.",
    )
    expect(
      trigger.compareDocumentPosition(emptyCollection) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0)
  })

  it("opens sharing without enabling the link, then allows explicit activation", () => {
    render(<BadgesSection />)
    const panel = openSharing()
    const dialog = screen.getByRole("dialog", { name: "Share my badges" })

    expect(dialog.getAttribute("aria-modal")).toBe(mobile ? "true" : null)
    expect(
      panel.getByText(
        "Activate a public link to share your name, photo and badges. Your email stays private.",
      ),
    ).toBeTruthy()
    expect(panel.queryByRole("button", { name: "Copy link" })).toBeNull()
    expect(screen.queryByRole("button", { name: /reset/i })).toBeNull()
    expect(state.mutate).not.toHaveBeenCalled()
    fireEvent.click(panel.getByRole("button", { name: "Activate link" }))
    expect(state.mutate).toHaveBeenCalledWith(true, expect.any(Object))
  })

  it("copies the existing link, closes the panel and returns focus", async () => {
    state.enabled = true
    render(<BadgesSection />)
    const panel = openSharing()

    expect(
      panel.getByText(
        "Anyone with the link sees your name, photo and badges. Never your email.",
      ),
    ).toBeTruthy()
    fireEvent.click(panel.getByRole("button", { name: "Copy link" }))

    await waitFor(() => {
      expect(state.copy).toHaveBeenCalledWith(
        `${window.location.origin}/u/fixture-public-link`,
      )
      expect(screen.queryByRole("dialog")).toBeNull()
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Share" }),
      )
    })
    expect(toast.success).toHaveBeenCalledWith("Link copied")
    expect(state.mutate).not.toHaveBeenCalled()
  })

  it("allows explicit deactivation without regenerating the link", () => {
    state.enabled = true
    render(<BadgesSection />)
    const panel = openSharing()

    expect(panel.queryByRole("button", { name: /reset/i })).toBeNull()
    fireEvent.click(panel.getByRole("button", { name: "Deactivate link" }))
    expect(state.mutate).toHaveBeenCalledWith(false, expect.any(Object))
    expect(state.copy).not.toHaveBeenCalled()
  })

  it("disables sharing actions while a visibility change is pending", () => {
    state.enabled = true
    state.pending = true
    render(<BadgesSection />)
    const panel = openSharing()

    for (const name of ["Copy link", "Deactivate link"]) {
      const action = panel.getByRole("button", { name })
      expect(action.hasAttribute("disabled")).toBe(true)
      fireEvent.click(action)
    }
    expect(state.mutate).not.toHaveBeenCalled()
    expect(state.copy).not.toHaveBeenCalled()
  })

  it("shows a mutation failure without closing the panel or exposing a link", () => {
    render(<BadgesSection />)
    const panel = openSharing()
    fireEvent.click(panel.getByRole("button", { name: "Activate link" }))
    state.mutate.mock.calls[0][1].onError()

    expect(toast.error).toHaveBeenCalledWith(
      "Could not update sharing. Please try again.",
    )
    expect(screen.getByRole("dialog", { name: "Share my badges" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull()
  })

  it("keeps the panel open if copying fails", async () => {
    state.enabled = true
    state.copy.mockRejectedValueOnce(new Error("Clipboard unavailable"))
    render(<BadgesSection />)
    const panel = openSharing()
    fireEvent.click(panel.getByRole("button", { name: "Copy link" }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Could not copy the link")
    })
    expect(screen.getByRole("dialog", { name: "Share my badges" })).toBeTruthy()
    expect(state.mutate).not.toHaveBeenCalled()
  })

  it("closes on Escape and returns focus without changing visibility", async () => {
    render(<BadgesSection />)
    openSharing()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull()
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Share" }),
      )
    })
    expect(state.mutate).not.toHaveBeenCalled()
  })
})
