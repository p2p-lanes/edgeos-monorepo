import { act, render } from "@testing-library/react"
import { useRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { TicketingStepPublic } from "@/client"
import { PREVIEW_MESSAGE_SOURCE } from "./previewProtocol"
import { useStepPreviewBridge } from "./useStepPreviewBridge"

const ORIGIN = "https://demo.edgeos.world"

function step(
  overrides: Partial<TicketingStepPublic> = {},
): TicketingStepPublic {
  return {
    id: "step-1",
    tenant_id: "tenant-1",
    popup_id: "popup-1",
    step_type: "tickets",
    title: "Tickets",
    ...overrides,
  }
}

/** Stands in for the iframe: the hook only ever touches `contentWindow`. */
function harness(postMessage: ReturnType<typeof vi.fn>) {
  return function Harness({
    previewToken,
    step: draft,
    targetOrigin = ORIGIN,
  }: {
    previewToken: string | null
    step: TicketingStepPublic | null
    targetOrigin?: string | null
  }) {
    const iframeRef = useRef<HTMLIFrameElement | null>({
      contentWindow: { postMessage },
    } as unknown as HTMLIFrameElement)

    useStepPreviewBridge({ iframeRef, targetOrigin, previewToken, step: draft })
    return null
  }
}

function announceReady(origin = ORIGIN) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin,
        data: { source: PREVIEW_MESSAGE_SOURCE, type: "ready" },
      }),
    )
  })
}

describe("useStepPreviewBridge", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("sends the current draft as soon as the preview says it is ready", () => {
    const postMessage = vi.fn()
    const Harness = harness(postMessage)
    render(<Harness previewToken="token-1" step={step()} />)

    expect(postMessage).not.toHaveBeenCalled()

    announceReady()

    expect(postMessage).toHaveBeenCalledWith(
      {
        source: PREVIEW_MESSAGE_SOURCE,
        type: "state",
        previewToken: "token-1",
        step: step(),
      },
      ORIGIN,
    )
  })

  it("ignores a ready signal from another origin", () => {
    const postMessage = vi.fn()
    const Harness = harness(postMessage)
    render(<Harness previewToken="token-1" step={step()} />)

    announceReady("https://evil.example.com")

    expect(postMessage).not.toHaveBeenCalled()
  })

  it("debounces edits into a single send", () => {
    const postMessage = vi.fn()
    const Harness = harness(postMessage)
    const { rerender } = render(
      <Harness previewToken="token-1" step={step()} />,
    )
    announceReady()
    postMessage.mockClear()

    rerender(<Harness previewToken="token-1" step={step({ title: "T" })} />)
    rerender(<Harness previewToken="token-1" step={step({ title: "Ti" })} />)
    rerender(<Harness previewToken="token-1" step={step({ title: "Tic" })} />)

    expect(postMessage).not.toHaveBeenCalled()

    act(() => void vi.advanceTimersByTime(300))

    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage.mock.calls[0][0].step.title).toBe("Tic")
  })

  it("stays silent until it has a token", () => {
    const postMessage = vi.fn()
    const Harness = harness(postMessage)
    const { rerender } = render(<Harness previewToken={null} step={step()} />)

    announceReady()
    expect(postMessage).not.toHaveBeenCalled()

    rerender(<Harness previewToken="token-1" step={step()} />)
    act(() => void vi.advanceTimersByTime(300))
    expect(postMessage).toHaveBeenCalledTimes(1)
  })

  // The preview covers the whole checkout and is opened from the page, so it
  // has to work with no step open in the editor.
  it("sends the token with no step at all", () => {
    const postMessage = vi.fn()
    const Harness = harness(postMessage)
    render(<Harness previewToken="token-1" step={null} />)

    announceReady()

    expect(postMessage).toHaveBeenCalledWith(
      {
        source: PREVIEW_MESSAGE_SOURCE,
        type: "state",
        previewToken: "token-1",
        step: null,
      },
      ORIGIN,
    )
  })

  it("does nothing without a target origin", () => {
    const postMessage = vi.fn()
    const Harness = harness(postMessage)
    render(<Harness previewToken="token-1" step={step()} targetOrigin={null} />)

    announceReady()
    act(() => void vi.advanceTimersByTime(300))

    expect(postMessage).not.toHaveBeenCalled()
  })
})
