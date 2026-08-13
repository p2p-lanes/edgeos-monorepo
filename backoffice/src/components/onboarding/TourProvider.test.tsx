/**
 * Tests for TourProvider — the tour's state machine.
 *
 * Covers:
 * - auto-start on a user's first login, and staying quiet afterwards
 * - Next / Back / Skip, including Back being inert on the first step
 * - Skip and Finish both recording the tour as seen
 * - route navigation and the pre-step click that switches PopupForm's tabs
 *
 * Driven through a bare consumer rather than TourOverlay so these assert the
 * sequencing, not floating-ui's positioning.
 */
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const navigate = vi.fn()
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}))

const workspace = { selectedPopupId: "popup-1", isContextReady: true }
vi.mock("@/contexts/WorkspaceContext", () => ({
  useWorkspace: () => workspace,
}))

vi.mock("@/hooks/useAuth", () => ({
  default: () => ({ user: { id: "user-1", email: "chole@acme.com" } }),
}))

import { TourProvider, tourCompletedKey, useTour } from "./TourProvider"

function Consumer() {
  const { step, index, isActive, next, back, skip, start } = useTour()

  return (
    <div>
      <span data-testid="step">{step?.id ?? "none"}</span>
      <span data-testid="index">{index}</span>
      <span data-testid="active">{String(isActive)}</span>
      <button type="button" onClick={next}>
        next
      </button>
      <button type="button" onClick={back}>
        back
      </button>
      <button type="button" onClick={skip}>
        skip
      </button>
      <button type="button" onClick={start}>
        start
      </button>
    </div>
  )
}

function renderTour() {
  return render(
    <TourProvider>
      <Consumer />
    </TourProvider>,
  )
}

const stepId = () => screen.getByTestId("step").textContent

beforeEach(() => {
  localStorage.clear()
  navigate.mockClear()
  workspace.selectedPopupId = "popup-1"
  workspace.isContextReady = true
  document.body.innerHTML = ""
})

describe("TourProvider", () => {
  it("starts on its own the first time a user signs in", async () => {
    renderTour()

    await waitFor(() =>
      expect(screen.getByTestId("active")).toHaveTextContent("true"),
    )
    expect(stepId()).toBe("welcome")
  })

  it("stays quiet once the user has seen it", async () => {
    localStorage.setItem(tourCompletedKey("user-1"), "1")

    renderTour()

    await waitFor(() =>
      expect(screen.getByTestId("active")).toHaveTextContent("false"),
    )
  })

  it("waits for the workspace before building the step list", async () => {
    // Steps are derived from the selected gathering; starting early would
    // build the tour without its gathering act.
    workspace.isContextReady = false

    renderTour()

    await waitFor(() =>
      expect(screen.getByTestId("active")).toHaveTextContent("false"),
    )
  })

  it("advances and rewinds", async () => {
    const user = userEvent.setup()
    renderTour()
    await waitFor(() => expect(stepId()).toBe("welcome"))

    await user.click(screen.getByText("next"))
    expect(stepId()).toBe("gathering-overview")

    await user.click(screen.getByText("next"))
    expect(stepId()).toBe("gathering-general")

    await user.click(screen.getByText("back"))
    expect(stepId()).toBe("gathering-overview")
  })

  it("does not rewind past the first step", async () => {
    const user = userEvent.setup()
    renderTour()
    await waitFor(() => expect(stepId()).toBe("welcome"))

    await user.click(screen.getByText("back"))

    expect(screen.getByTestId("index")).toHaveTextContent("0")
    expect(stepId()).toBe("welcome")
  })

  it("skip closes the whole tour and remembers it", async () => {
    const user = userEvent.setup()
    renderTour()
    await waitFor(() => expect(stepId()).toBe("welcome"))

    await user.click(screen.getByText("next"))
    await user.click(screen.getByText("skip"))

    expect(screen.getByTestId("active")).toHaveTextContent("false")
    expect(localStorage.getItem(tourCompletedKey("user-1"))).toBe("1")
  })

  it("finishing the last step also records it as seen", async () => {
    const user = userEvent.setup()
    renderTour()
    await waitFor(() => expect(stepId()).toBe("welcome"))

    // Walk to the end; the last Next finishes rather than overrunning.
    for (let i = 0; i < 20; i++) {
      if (screen.getByTestId("active").textContent === "false") break
      await user.click(screen.getByText("next"))
    }

    expect(screen.getByTestId("active")).toHaveTextContent("false")
    expect(localStorage.getItem(tourCompletedKey("user-1"))).toBe("1")
  })

  it("can be replayed after being skipped", async () => {
    const user = userEvent.setup()
    renderTour()
    await waitFor(() => expect(stepId()).toBe("welcome"))

    await user.click(screen.getByText("next"))
    await user.click(screen.getByText("skip"))
    await user.click(screen.getByText("start"))

    expect(screen.getByTestId("active")).toHaveTextContent("true")
    expect(stepId()).toBe("welcome")
  })

  it("navigates to the gathering form for the gathering act", async () => {
    const user = userEvent.setup()
    renderTour()
    await waitFor(() => expect(stepId()).toBe("welcome"))

    await user.click(screen.getByText("next"))

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/popups/$id/edit",
        params: { id: "popup-1" },
      }),
    )
  })

  it("presses the tab a step needs active before it can be measured", async () => {
    const user = userEvent.setup()
    const tab = document.createElement("button")
    tab.setAttribute("data-tour", "popup-tab-general")
    const onClick = vi.fn()
    tab.addEventListener("click", onClick)
    document.body.appendChild(tab)

    renderTour()
    await waitFor(() => expect(stepId()).toBe("welcome"))

    await user.click(screen.getByText("next")) // gathering-overview
    await user.click(screen.getByText("next")) // gathering-general
    expect(stepId()).toBe("gathering-general")

    await waitFor(() => expect(onClick).toHaveBeenCalled())
  })

  it("skips the gathering act when the workspace has no gathering", async () => {
    workspace.selectedPopupId = null
    const user = userEvent.setup()
    renderTour()
    await waitFor(() => expect(stepId()).toBe("welcome"))

    await user.click(screen.getByText("next"))

    expect(stepId()).toBe("products")
  })
})
