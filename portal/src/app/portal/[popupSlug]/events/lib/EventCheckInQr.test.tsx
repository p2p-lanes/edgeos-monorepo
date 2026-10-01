import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { createElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { EventCheckInQr } from "./EventCheckInQr"

const getPortalEventCheckInLink = vi.fn()
const downloadQrPng = vi.fn(
  (_container: HTMLElement | null, _filename: string) => Promise.resolve(),
)
const writeText = vi.fn(() => Promise.resolve())

vi.mock("@/client", () => ({
  EventsService: {
    getPortalEventCheckInLink: (...args: unknown[]) =>
      getPortalEventCheckInLink(...args),
  },
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/lib/qr-download", () => ({
  downloadQrPng: (container: HTMLElement | null, filename: string) =>
    downloadQrPng(container, filename),
}))

vi.mock("react-qr-code", () => ({
  default: ({ value }: { value: string }) => (
    <div data-testid="qr" data-value={value} />
  ),
}))

const URL_FOR_EVENT =
  "https://edge.portal.test/portal/edge-city/events/event-1/check-in"

function renderPanel(
  props: Partial<Parameters<typeof EventCheckInQr>[0]> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
  return render(
    createElement(EventCheckInQr, {
      eventId: "event-1",
      occurrenceStart: null,
      canManage: true,
      ...props,
    }),
    { wrapper },
  )
}

beforeEach(() => {
  getPortalEventCheckInLink.mockReset()
  downloadQrPng.mockClear()
  writeText.mockClear()
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  })
})

describe("EventCheckInQr", () => {
  it("shows the QR and the exact URL a manager can read out", async () => {
    getPortalEventCheckInLink.mockResolvedValue({
      url: URL_FOR_EVENT,
      occurrence_start: null,
    })

    renderPanel()

    expect(await screen.findByText(URL_FOR_EVENT)).toBeTruthy()
    expect(screen.getByTestId("qr").getAttribute("data-value")).toBe(
      URL_FOR_EVENT,
    )
    // The copy control is icon-only now; its label is the accessible name.
    expect(
      screen.getByRole("button", { name: "events.check_in.copy_url" }),
    ).toBeTruthy()
  })

  it("renders nothing when the backend refuses the link", async () => {
    // A plain attendee gets 403 — the gate is the server's, not a hidden div.
    getPortalEventCheckInLink.mockRejectedValue(new Error("forbidden"))

    const { container } = renderPanel()

    await waitFor(() =>
      expect(getPortalEventCheckInLink).toHaveBeenCalledTimes(1),
    )
    expect(container.textContent).toBe("")
  })

  it("does not ask for a link the viewer plainly cannot have", () => {
    renderPanel({ canManage: false })

    expect(getPortalEventCheckInLink).not.toHaveBeenCalled()
  })

  it("passes the occurrence so a series QR pins one date", async () => {
    getPortalEventCheckInLink.mockResolvedValue({
      url: `${URL_FOR_EVENT}?occ=2026-06-09T18%3A00%3A00Z`,
      occurrence_start: "2026-06-09T18:00:00Z",
    })

    renderPanel({ occurrenceStart: "2026-06-09T18:00:00Z" })

    await waitFor(() =>
      expect(getPortalEventCheckInLink).toHaveBeenCalledWith({
        eventId: "event-1",
        occurrenceStart: "2026-06-09T18:00:00Z",
      }),
    )
  })
})

describe("EventCheckInQr controls", () => {
  beforeEach(() => {
    getPortalEventCheckInLink.mockResolvedValue({
      url: URL_FOR_EVENT,
      occurrence_start: null,
    })
  })

  it("keeps the URL to one line and exposes the full value on hover", async () => {
    renderPanel()

    const line = await screen.findByText(URL_FOR_EVENT)
    // `truncate` is what produces the ellipsis; the title carries the rest.
    expect(line.className).toContain("truncate")
    expect(line.getAttribute("title")).toBe(URL_FOR_EVENT)
  })

  it("copies the whole URL, not the ellipsised text", async () => {
    renderPanel()
    await screen.findByText(URL_FOR_EVENT)

    fireEvent.click(
      screen.getByRole("button", { name: "events.check_in.copy_url" }),
    )

    // waitFor flushes the state update the async clipboard write
    // schedules, which otherwise lands outside act().
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_FOR_EVENT))
  })

  it("saves the QR under a filename that names the event", async () => {
    renderPanel()
    await screen.findByText(URL_FOR_EVENT)

    fireEvent.click(
      screen.getByRole("button", { name: "events.check_in.download_qr" }),
    )

    await waitFor(() => expect(downloadQrPng).toHaveBeenCalledTimes(1))
    expect(downloadQrPng.mock.calls[0][1]).toBe("event-check-in-event-1.png")
  })

  it("stays quiet when the download fails", async () => {
    downloadQrPng.mockRejectedValueOnce(new Error("no canvas"))
    renderPanel()
    await screen.findByText(URL_FOR_EVENT)

    fireEvent.click(
      screen.getByRole("button", { name: "events.check_in.download_qr" }),
    )

    // The QR is still on screen and showable, so a failed save is not worth
    // interrupting an organizer at a door over.
    expect(screen.getByTestId("qr")).toBeTruthy()
  })
})
