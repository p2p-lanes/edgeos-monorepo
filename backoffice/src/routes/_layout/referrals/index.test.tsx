import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(() => new Error("redirected")),
}))

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { beforeLoad: () => never }) => options,
  redirect: mocks.redirect,
}))

import { Route } from "./index"

describe("referrals compatibility route", () => {
  it("redirects the legacy list to the unified links screen", () => {
    expect(() => Route.beforeLoad()).toThrow("redirected")
    expect(mocks.redirect).toHaveBeenCalledWith({ to: "/invites" })
  })
})
