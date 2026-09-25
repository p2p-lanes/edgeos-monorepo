import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { EventMessagesService } from "@/client"
import { EventMessages } from "./EventMessages"

vi.mock("@/client", () => ({
  EventMessagesService: {
    listEventMessages: vi.fn(),
    sendEventMessage: vi.fn(),
  },
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(EventMessagesService.listEventMessages).mockResolvedValue({
    results: [],
    paging: { offset: 0, limit: 20, total: 0 },
  })
})
afterEach(cleanup)

function mount(canSend = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <EventMessages
        eventId="event-1"
        occurrenceStart="2026-10-09T01:00:00Z"
        timezone="UTC"
        canSend={canSend}
      />
    </QueryClientProvider>,
  )
}

it("reuses the send ID after a network failure and refreshes history after success", async () => {
  const send = vi.mocked(EventMessagesService.sendEventMessage)
  send.mockRejectedValueOnce(new Error("Connection interrupted"))
  const result = {
    id: "message-1",
    body: "Please arrive early",
    event_id: "event-1",
    author_name: "Host",
    occurrence_start: "2026-10-09T01:00:00Z",
    recipient_count: 1,
    sent_count: 1,
    failed_count: 0,
    created_at: "2026-10-01T12:00:00Z",
    completed_at: "2026-10-01T12:00:01Z",
  }
  send.mockResolvedValueOnce(result)
  vi.mocked(EventMessagesService.listEventMessages)
    .mockResolvedValueOnce({
      results: [],
      paging: { offset: 0, limit: 20, total: 0 },
    })
    .mockResolvedValue({
      results: [result],
      paging: { offset: 0, limit: 20, total: 1 },
    })
  mount()
  const input = screen.getByLabelText("events.messages.message")
  fireEvent.change(input, { target: { value: " Please arrive early " } })
  fireEvent.click(screen.getByRole("button", { name: "events.messages.send" }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "events.messages.send" }),
    ).toHaveProperty("disabled", false),
  )
  fireEvent.click(screen.getByRole("button", { name: "events.messages.send" }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0])
  expect(send.mock.calls[0][0].requestBody.body).toBe("Please arrive early")
  expect(send.mock.calls[0][0].requestBody.occurrence_start).toBe(
    "2026-10-09T01:00:00Z",
  )
  await waitFor(() =>
    expect(screen.getByText("Please arrive early")).toBeTruthy(),
  )
  expect(input).toHaveProperty("value", "")
})

it("keeps history available when sending is disabled and displays messages as text", async () => {
  vi.mocked(EventMessagesService.listEventMessages).mockResolvedValue({
    results: [
      {
        id: "message-1",
        event_id: "event-1",
        author_name: "Host",
        body: "<img src=x onerror=alert(1)>",
        occurrence_start: null,
        recipient_count: 2,
        sent_count: 1,
        failed_count: 1,
        created_at: "2026-10-01T12:00:00Z",
        completed_at: "2026-10-01T12:00:01Z",
      },
    ],
    paging: { offset: 0, limit: 20, total: 1 },
  })
  const view = mount(false)
  expect(
    screen.queryByRole("button", { name: "events.messages.send" }),
  ).toBeNull()
  await screen.findByText("<img src=x onerror=alert(1)>")
  expect(view.container.querySelector("img")).toBeNull()
})
