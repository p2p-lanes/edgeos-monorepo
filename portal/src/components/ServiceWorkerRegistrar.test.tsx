import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { authRequest } from "@/lib/session-lifecycle"
import { ServiceWorkerRegistrar } from "./ServiceWorkerRegistrar"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it("treats failed static-worker installation as background work in a proven clean browser", async () => {
  vi.stubEnv("NODE_ENV", "production")
  const register = vi.fn(async () => {
    throw new Error("Fake installation failure")
  })
  vi.stubGlobal("navigator", {
    serviceWorker: {
      controller: null,
      getRegistrations: vi.fn(async () => []),
      register,
    },
  })
  const fetchMock = vi.fn(async () => Response.json({ session: null }))
  vi.stubGlobal("fetch", fetchMock)
  render(
    <>
      <ServiceWorkerRegistrar />
      <div>Public entry</div>
    </>,
  )
  await waitFor(() => expect(register).toHaveBeenCalledOnce())
  await authRequest("session")
  expect(screen.getByText("Public entry")).toBeTruthy()
  expect(fetchMock).toHaveBeenCalledOnce()
})
