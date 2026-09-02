/**
 * The preview accepts its token from the page embedding it, and from nothing
 * else. These tests pin that boundary, and the fact that being embedded is the
 * only precondition — the route deliberately has no configuration to get wrong,
 * after an origin allowlist that needed some silently disabled the feature on
 * every deployment that lacked it.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type CheckoutRuntimeResponse, CheckoutService } from "@/client"
import { PREVIEW_MESSAGE_SOURCE } from "@/lib/checkout-preview"
import CheckoutPreviewClient from "./CheckoutPreviewClient"

const runtimeProps = vi.hoisted(() => vi.fn())
const themeProps = vi.hoisted(() => vi.fn())

vi.mock("@/client", () => ({
  CheckoutService: { getFlowRuntime: vi.fn() },
}))

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("flow=main"),
}))

// The checkout tree itself is covered elsewhere; here it only needs to be
// identifiable when it renders.
vi.mock("@/components/checkout-flow/OpenCheckoutRuntime", () => ({
  OpenCheckoutRuntime: (props: Record<string, unknown>) => {
    runtimeProps(props)
    return <div data-testid="checkout" />
  },
}))
vi.mock("@/providers/themeProvider", () => ({
  default: ({ children, ...props }: { children: ReactNode }) => {
    themeProps(props)
    return <>{children}</>
  },
}))
vi.mock("../CheckoutShell", () => ({
  CheckoutShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

const getFlowRuntime = vi.mocked(CheckoutService.getFlowRuntime)

function renderPreview() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CheckoutPreviewClient popupSlug="amanita" />
    </QueryClientProvider>,
  )
}

/** A real second window, so `MessageEvent.source` is a genuine WindowProxy. */
function makeEmbedder(): Window {
  const frame = document.createElement("iframe")
  document.body.appendChild(frame)
  const embedder = frame.contentWindow as Window
  Object.defineProperty(window, "parent", {
    value: embedder,
    configurable: true,
  })
  return embedder
}

function postState(source: Window, previewToken = "token-123") {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: PREVIEW_MESSAGE_SOURCE, type: "state", previewToken },
        source,
      }),
    )
  })
}

const realParent = Object.getOwnPropertyDescriptor(window, "parent")

beforeEach(() => {
  getFlowRuntime.mockResolvedValue({
    popup: { id: "popup-1" },
    theme_config: { primary_color: "#123456" },
    products: [],
    ticketing_steps: [],
    // A stand-in: what the runtime holds is the checkout's business, not this
    // boundary's.
  } as unknown as CheckoutRuntimeResponse)
})

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ""
  if (realParent) Object.defineProperty(window, "parent", realParent)
})

describe("CheckoutPreviewClient", () => {
  it("renders the checkout once the embedder posts a token", async () => {
    const embedder = makeEmbedder()
    renderPreview()

    postState(embedder)

    expect(await screen.findByTestId("checkout")).toBeTruthy()
    expect(getFlowRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "amanita",
        flowSlug: "main",
        xCheckoutPreviewToken: "token-123",
      }),
    )
    expect(runtimeProps).toHaveBeenCalledWith(
      expect.objectContaining({
        popupSlug: "amanita",
        flowSlug: "main",
        previewMode: true,
        previewToken: "token-123",
      }),
    )
    expect(themeProps).toHaveBeenCalledWith({
      config: { primary_color: "#123456" },
      scope: "local",
    })
  })

  it("announces itself to the embedder so the token is sent without a reload", () => {
    const embedder = makeEmbedder()
    const postMessage = vi.spyOn(embedder, "postMessage")

    renderPreview()

    expect(postMessage).toHaveBeenCalledWith(
      { source: PREVIEW_MESSAGE_SOURCE, type: "ready" },
      "*",
    )
  })

  // The token is the authorization, so it is only ever taken from the window
  // this page is embedded in — an opener or a sibling frame is not it.
  it("ignores a token posted by anything other than its embedder", async () => {
    makeEmbedder()
    renderPreview()

    postState(window, "smuggled-token")

    await waitFor(() => expect(getFlowRuntime).not.toHaveBeenCalled())
  })

  it("says so when opened outside the backoffice instead of spinning", () => {
    renderPreview()

    expect(screen.getByText("Nothing to preview here")).toBeTruthy()
    expect(getFlowRuntime).not.toHaveBeenCalled()
  })
})
