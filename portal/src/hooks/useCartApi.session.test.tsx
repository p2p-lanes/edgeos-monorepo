import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { rotateSessionRequests } from "@/lib/session-network"
import QueryProvider from "@/providers/queryProvider"
import { SessionProvider, useSession } from "@/providers/sessionProvider"
import { EMPTY_CART, useSaveCart } from "./useCartApi"

const sendCart = vi.hoisted(() => vi.fn())
vi.mock("@/client/core/request", () => ({ request: sendCart }))
vi.mock("@/lib/service-worker", () => ({
  ensureSafeServiceWorker: vi.fn(async () => {}),
}))
vi.mock("@/components/ui/Loader", () => ({
  Loader: () => <div>Checking session</div>,
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function CartEditor() {
  const { save } = useSaveCart("popup", "flow")
  const { lifecycle } = useSession()
  return (
    <>
      <button type="button" onClick={() => save(EMPTY_CART)}>
        Queue save
      </button>
      <button
        type="button"
        onClick={() => {
          void lifecycle.logout()
        }}
      >
        Logout
      </button>
    </>
  )
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  rotateSessionRequests()
})

it("cancels an old identity's debounced cart save before cookie logout completes", async () => {
  vi.useFakeTimers()
  localStorage.clear()
  sendCart.mockReset()
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ session: null })),
  )
  render(
    <SessionProvider
      initial={{
        status: "authenticated",
        session: {
          human: {
            id: "human",
            tenant_id: "tenant",
            email: "fake@example.com",
          },
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
      }}
      onNavigate={vi.fn()}
    >
      <QueryProvider>
        <CartEditor />
      </QueryProvider>
    </SessionProvider>,
  )
  await act(async () => {})
  fireEvent.click(screen.getByText("Queue save"))
  fireEvent.click(screen.getByText("Logout"))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(sendCart).not.toHaveBeenCalled()
  expect(screen.queryByText("Queue save")).toBeNull()
})
