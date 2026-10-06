import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  loading: true,
  allowed: false,
  push: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/portal/india/attendees",
  useRouter: () => ({ push: state.push }),
}))
vi.mock("../hooks/useResources", () => ({
  default: () => ({
    permissionsLoading: state.loading,
    resources: [
      {
        path: "/portal/india/attendees",
        status: state.allowed ? "active" : "hidden",
      },
    ],
  }),
}))
vi.mock("@/components/ui/Loader", () => ({
  Loader: () => <div data-testid="permissions-loader" />,
}))

import Permissions from "./Permissions"

afterEach(cleanup)
beforeEach(() => {
  state.loading = true
  state.allowed = false
  state.push.mockClear()
})

function page() {
  return (
    <Permissions>
      <div>Attendee directory content</div>
    </Permissions>
  )
}

describe("Permissions initial-load gate", () => {
  it("does not deny or redirect while permission data is loading", () => {
    render(page())
    expect(state.push).not.toHaveBeenCalled()
    expect(screen.getByTestId("permissions-loader")).toBeTruthy()
    expect(screen.queryByText("Attendee directory content")).toBeNull()
    expect(
      screen.queryByText("You are not authorized to access this page"),
    ).toBeNull()
  })

  it("renders an accepted participant after a cold load without bouncing home", () => {
    const view = render(page())
    expect(state.push).not.toHaveBeenCalled()
    state.loading = false
    state.allowed = true
    view.rerender(page())
    expect(screen.getByText("Attendee directory content")).toBeTruthy()
    expect(screen.queryByTestId("permissions-loader")).toBeNull()
    expect(state.push).not.toHaveBeenCalled()
  })

  it("still denies a participant without access, but only after loading settles", () => {
    const view = render(page())
    expect(state.push).not.toHaveBeenCalled()
    state.loading = false
    view.rerender(page())
    expect(state.push).toHaveBeenCalledWith("/portal")
    expect(screen.queryByText("Attendee directory content")).toBeNull()
    expect(
      screen.getByText("You are not authorized to access this page"),
    ).toBeTruthy()
  })

  it("does not bounce an already resolved authorized session on later renders", () => {
    state.loading = false
    state.allowed = true
    const view = render(page())
    view.rerender(page())
    expect(screen.getByText("Attendee directory content")).toBeTruthy()
    expect(state.push).not.toHaveBeenCalled()
  })
})
